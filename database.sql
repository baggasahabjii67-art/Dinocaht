-- ============================================================
-- DINOCHAT DATABASE v2
-- Global users, scores, rankings, achievements, friends,
-- social views, score transfers, bets and sessions.
-- ============================================================

-- ============================================================
-- ENUMS
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'friend_request_status'
    ) THEN
        CREATE TYPE friend_request_status AS ENUM (
            'pending',
            'accepted',
            'rejected'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'social_content_type'
    ) THEN
        CREATE TYPE social_content_type AS ENUM (
            'instagram',
            'snap'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'bet_status'
    ) THEN
        CREATE TYPE bet_status AS ENUM (
            'waiting',
            'accepted',
            'active',
            'completed',
            'cancelled'
        );
    END IF;
END $$;


-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    dino_id TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL,

    dino_score NUMERIC(12,2) NOT NULL DEFAULT 0.10,

    -- Maximum progression is Dino1000.
    -- No automatic restart/reset after reaching it.
    score_tier TEXT NOT NULL DEFAULT 'D0.1',

    total_messages BIGINT NOT NULL DEFAULT 0,
    total_snaps BIGINT NOT NULL DEFAULT 0,
    total_photos BIGINT NOT NULL DEFAULT 0,

    total_social_views BIGINT NOT NULL DEFAULT 0,
    unique_social_views BIGINT NOT NULL DEFAULT 0,

    scores_sent NUMERIC(12,2) NOT NULL DEFAULT 0,
    scores_received NUMERIC(12,2) NOT NULL DEFAULT 0,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    last_seen_at TIMESTAMPTZ,
    is_online BOOLEAN NOT NULL DEFAULT FALSE
);


CREATE INDEX IF NOT EXISTS idx_users_dino_id
ON users(dino_id);

CREATE INDEX IF NOT EXISTS idx_users_score
ON users(dino_score DESC);

CREATE INDEX IF NOT EXISTS idx_users_online
ON users(is_online);


-- ============================================================
-- CHAT MESSAGES
-- ============================================================

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_dino_id TEXT NOT NULL,

    content TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    edited_at TIMESTAMPTZ,

    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_messages_created
ON messages(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_sender
ON messages(sender_id);


-- ============================================================
-- ACTIVE SESSIONS
-- MAXIMUM 2 ACTIVE CONNECTIONS PER DINO ID
-- ============================================================

CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dino_id TEXT NOT NULL,

    session_token_hash TEXT NOT NULL UNIQUE,

    device_type TEXT,
    device_name TEXT,

    connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    disconnected_at TIMESTAMPTZ,

    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user
ON sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_sessions_dino
ON sessions(dino_id);

CREATE INDEX IF NOT EXISTS idx_sessions_active
ON sessions(dino_id, is_active);


-- ============================================================
-- ACHIEVEMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS achievements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    achievement_key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,

    icon TEXT,
    category TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE TABLE IF NOT EXISTS user_achievements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_id UUID NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,

    earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(user_id, achievement_id)
);

CREATE INDEX IF NOT EXISTS idx_user_achievements_user
ON user_achievements(user_id);


-- ============================================================
-- DAILY #1 RANK HISTORY
-- ============================================================

CREATE TABLE IF NOT EXISTS daily_rankings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    ranking_date DATE NOT NULL,

    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dino_id TEXT NOT NULL,

    rank_position INTEGER NOT NULL,

    score NUMERIC(12,2) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(ranking_date, rank_position)
);

CREATE INDEX IF NOT EXISTS idx_daily_rankings_date
ON daily_rankings(ranking_date);

CREATE INDEX IF NOT EXISTS idx_daily_rankings_user
ON daily_rankings(user_id);


-- ============================================================
-- FRIEND REQUESTS
-- ============================================================

CREATE TABLE IF NOT EXISTS friend_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    status friend_request_status NOT NULL DEFAULT 'pending',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    responded_at TIMESTAMPTZ,

    UNIQUE(sender_id, receiver_id)
);

CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver
ON friend_requests(receiver_id, status);

CREATE INDEX IF NOT EXISTS idx_friend_requests_sender
ON friend_requests(sender_id, status);


-- ============================================================
-- FRIENDSHIPS
-- ============================================================

CREATE TABLE IF NOT EXISTS friendships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_a UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK(user_a <> user_b),

    UNIQUE(user_a, user_b)
);

CREATE INDEX IF NOT EXISTS idx_friendships_a
ON friendships(user_a);

CREATE INDEX IF NOT EXISTS idx_friendships_b
ON friendships(user_b);


-- ============================================================
-- DINO SCORE TRANSFERS
-- ============================================================

CREATE TABLE IF NOT EXISTS score_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    amount NUMERIC(12,2) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    note TEXT,

    CHECK(amount > 0),
    CHECK(sender_id <> receiver_id)
);

CREATE INDEX IF NOT EXISTS idx_score_transfers_sender
ON score_transfers(sender_id);

CREATE INDEX IF NOT EXISTS idx_score_transfers_receiver
ON score_transfers(receiver_id);


-- ============================================================
-- SOCIAL CONTENT
-- INSTAGRAM / SNAP
-- ============================================================

CREATE TABLE IF NOT EXISTS social_content (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    owner_dino_id TEXT NOT NULL,

    content_type social_content_type NOT NULL,

    original_url TEXT NOT NULL,

    -- Verified URL after server-side validation.
    verified_url TEXT,

    is_verified BOOLEAN NOT NULL DEFAULT FALSE,

    total_views BIGINT NOT NULL DEFAULT 0,
    unique_views BIGINT NOT NULL DEFAULT 0,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_owner
ON social_content(owner_id);

CREATE INDEX IF NOT EXISTS idx_social_type
ON social_content(content_type);


-- ============================================================
-- SOCIAL VIEWS
-- ONE VIEW RECORD PER DINO ID + CONTENT
-- ============================================================

CREATE TABLE IF NOT EXISTS social_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    content_id UUID NOT NULL REFERENCES social_content(id) ON DELETE CASCADE,
    viewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(content_id, viewer_id)
);

CREATE INDEX IF NOT EXISTS idx_social_views_content
ON social_views(content_id);

CREATE INDEX IF NOT EXISTS idx_social_views_viewer
ON social_views(viewer_id);


-- ============================================================
-- CHESS BETS
-- VIRTUAL DINO SCORE ONLY
-- ============================================================

CREATE TABLE IF NOT EXISTS chess_bets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    creator_dino_id TEXT NOT NULL,

    opponent_id UUID REFERENCES users(id) ON DELETE SET NULL,
    opponent_dino_id TEXT,

    stake NUMERIC(12,2) NOT NULL,

    status bet_status NOT NULL DEFAULT 'waiting',

    winner_id UUID REFERENCES users(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    CHECK(stake > 0)
);

CREATE INDEX IF NOT EXISTS idx_chess_bets_status
ON chess_bets(status);

CREATE INDEX IF NOT EXISTS idx_chess_bets_creator
ON chess_bets(creator_id);

CREATE INDEX IF NOT EXISTS idx_chess_bets_opponent
ON chess_bets(opponent_id);


-- ============================================================
-- BET TRANSACTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS bet_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    bet_id UUID NOT NULL REFERENCES chess_bets(id) ON DELETE CASCADE,

    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    amount NUMERIC(12,2) NOT NULL,

    transaction_type TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bet_transactions_bet
ON bet_transactions(bet_id);


-- ============================================================
-- ACTION COUNTERS
-- Used for automatic score rewards.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_action_counters (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

    messages_count BIGINT NOT NULL DEFAULT 0,
    snaps_count BIGINT NOT NULL DEFAULT 0,
    photos_count BIGINT NOT NULL DEFAULT 0,

    last_message_reward_count BIGINT NOT NULL DEFAULT 0,
    last_snap_reward_count BIGINT NOT NULL DEFAULT 0,
    last_photo_reward_count BIGINT NOT NULL DEFAULT 0,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- LAYOUT CUSTOMIZATION
-- COLORS ARE NOT STORED HERE.
-- This is ONLY button/layout arrangement.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_layouts (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

    layout_name TEXT NOT NULL DEFAULT 'classic',

    layout_data JSONB NOT NULL DEFAULT '{}'::jsonb,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- ACHIEVEMENT SEED DATA
-- ============================================================

INSERT INTO achievements
    (achievement_key, name, description, icon, category)
VALUES
    (
        'dino_of_day',
        'Dino of the Day',
        'Hold rank #1 for a complete day.',
        '🦖',
        'ranking'
    ),
    (
        'dino_top_3',
        'Dino Top 3',
        'Reach the global top 3.',
        '🏆',
        'ranking'
    ),
    (
        'snap_10',
        'Snap Starter',
        'Send 10 snaps.',
        '📸',
        'social'
    ),
    (
        'snap_50',
        'Snap Master',
        'Send 50 snaps.',
        '🔥',
        'social'
    ),
    (
        'photo_50',
        'Photo Hunter',
        'Send 50 photos.',
        '📷',
        'social'
    ),
    (
        'social_views_100',
        'Dino Famous',
        'Receive 100 unique Dino views.',
        '👀',
        'social'
    ),
    (
        'first_friend',
        'Dino Friend',
        'Successfully accept your first friend request.',
        '🤝',
        'friends'
    ),
    (
        'first_chess_win',
        'Dino Challenger',
        'Win your first chess match.',
        '♟️',
        'games'
    ),
    (
        'score_sender',
        'Dino Giver',
        'Send Dino Score to another Dino.',
        '🎁',
        'score'
    ),
    (
        'dino_100',
        'Dino 100',
        'Reach Dino100.',
        '💯',
        'ranking'
    ),
    (
        'dino_1000',
        'Dino 1000',
        'Reach the maximum Dino1000 limit.',
        '👑',
        'ranking'
    )
ON CONFLICT (achievement_key) DO NOTHING;


-- ============================================================
-- SCORE RANKING VIEW
-- ============================================================

CREATE OR REPLACE VIEW live_dino_rankings AS
SELECT
    ROW_NUMBER() OVER (
        ORDER BY dino_score DESC, created_at ASC
    ) AS rank_position,

    id,
    dino_id,
    username,
    dino_score,
    score_tier,
    total_messages,
    total_snaps,
    total_photos,
    total_social_views,
    unique_social_views,
    is_online

FROM users;


-- ============================================================
-- AUTOMATIC updated_at FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================

DROP TRIGGER IF EXISTS users_updated_at ON users;

CREATE TRIGGER users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


DROP TRIGGER IF EXISTS social_content_updated_at ON social_content;

CREATE TRIGGER social_content_updated_at
BEFORE UPDATE ON social_content
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


DROP TRIGGER IF EXISTS user_layouts_updated_at ON user_layouts;

CREATE TRIGGER user_layouts_updated_at
BEFORE UPDATE ON user_layouts
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- CLEANUP FUNCTION
-- Sessions older than 24 hours and marked active can be
-- automatically treated as stale by the backend.
-- ============================================================

CREATE OR REPLACE FUNCTION cleanup_stale_sessions()
RETURNS VOID AS $$
BEGIN
    UPDATE sessions
    SET
        is_active = FALSE,
        disconnected_at = COALESCE(disconnected_at, NOW())
    WHERE
        is_active = TRUE
        AND last_seen_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- FINAL CHECK
-- ============================================================

SELECT 'DinoChat database v2 installed successfully.' AS status;
