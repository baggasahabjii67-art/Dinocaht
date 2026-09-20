"use strict";

/*
============================================================
DINOCHAT SERVER v2
============================================================

Requires:
  express
  cors
  socket.io
  @supabase/supabase-js

Environment variables:
  PORT
  SUPABASE_URL
  SUPABASE_SECRET_KEY

IMPORTANT:
  SUPABASE_SECRET_KEY MUST NEVER be placed in frontend code.
============================================================
*/

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const http = require("http");
const { Server } = require("socket.io");
const { createClient } = require("@supabase/supabase-js");

// ============================================================
// CONFIG
// ============================================================

const PORT = Number(process.env.PORT || 3000);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    console.error(
        "Missing SUPABASE_URL or SUPABASE_SECRET_KEY environment variable."
    );
    process.exit(1);
}

// Server-only Supabase client.
// The secret key must stay on the backend.
const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_SECRET_KEY,
    {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
        }
    }
);

// ============================================================
// APP
// ============================================================

const app = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
    },
    transports: ["websocket", "polling"]
});

app.use(
    cors({
        origin: "*",
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"]
    })
);

app.use(express.json({ limit: "2mb" }));

// ============================================================
// CONSTANTS
// ============================================================

const MAX_ACTIVE_SESSIONS = 2;
const MAX_DINO_SCORE = 1000;

const TOKEN_BYTES = 32;

// ============================================================
// UTILITY
// ============================================================

function asyncHandler(fn) {
    return function wrapped(req, res, next) {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

function cleanString(value, max = 200) {
    if (typeof value !== "string") return "";
    return value.trim().slice(0, max);
}

function normalizeDinoId(value) {
    return cleanString(value, 50).toUpperCase();
}

function normalizeUsername(value) {
    return cleanString(value, 32);
}

function validUsername(username) {
    return (
        username.length >= 2 &&
        username.length <= 32 &&
        /^[a-zA-Z0-9_. -]+$/.test(username)
    );
}

function makeDinoId() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let result = "";

    for (let i = 0; i < 8; i++) {
        result += chars[crypto.randomInt(0, chars.length)];
    }

    return `DINO-${result}`;
}

function makeToken() {
    return crypto.randomBytes(TOKEN_BYTES).toString("hex");
}

function hashToken(token) {
    return crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");
}

function scoreNumber(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) return 0;

    return number;
}

/*
------------------------------------------------------------
DINO SCORE TIERS

The important rule:

D0.1 -> D0.2 -> ... -> D0.9
TD0.1 -> ... -> TD0.99
Dino1 -> Dino2 -> ... -> Dino1000

Dino1000 is the permanent maximum.

There is NO reset after Dino1000.
------------------------------------------------------------
*/

function calculateTier(score) {
    const value = scoreNumber(score);

    if (value >= MAX_DINO_SCORE) {
        return "Dino1000";
    }

    if (value >= 1) {
        return `Dino${Math.floor(value)}`;
    }

    /*
    0.10 - 0.99
    */

    const hundredths = Math.round(value * 100);

    if (hundredths <= 9) {
        return `D0.${Math.max(1, hundredths)}`;
    }

    if (hundredths <= 99) {
        return `TD0.${hundredths - 9}`;
    }

    return "Dino1";
}

function clampScore(value) {
    const score = Number(value);

    if (!Number.isFinite(score)) {
        return 0.1;
    }

    return Math.min(MAX_DINO_SCORE, score);
}

function addScore(current, amount) {
    return clampScore(
        Math.round((Number(current) + Number(amount)) * 100) / 100
    );
}

function subtractScore(current, amount) {
    /*
    User requested that a losing bet can take a player
    into negative Dino Score.

    We therefore allow negative values for betting only.
    Normal progression still stops at Dino1000.
    */

    return Math.round(
        (Number(current) - Number(amount)) * 100
    ) / 100;
}

function scoreCanProgress(score) {
    return Number(score) < MAX_DINO_SCORE;
}

function scoreReward(score, amount) {
    if (!scoreCanProgress(score)) {
        return MAX_DINO_SCORE;
    }

    return addScore(score, amount);
}

// ============================================================
// SUPABASE HELPERS
// ============================================================

async function findUserByDinoId(dinoId) {
    const normalized = normalizeDinoId(dinoId);

    const { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("dino_id", normalized)
        .maybeSingle();

    if (error) throw error;

    return data;
}

async function findUserById(id) {
    const { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("id", id)
        .maybeSingle();

    if (error) throw error;

    return data;
}

async function createUniqueDinoId() {
    for (let attempt = 0; attempt < 20; attempt++) {
        const dinoId = makeDinoId();

        const existing = await findUserByDinoId(dinoId);

        if (!existing) {
            return dinoId;
        }
    }

    throw new Error("Could not generate unique Dino ID.");
}

async function createSession(user, deviceInfo = {}) {
    /*
    Maximum 2 active connections per Dino ID.
    */

    const { count, error: countError } = await supabase
        .from("sessions")
        .select("*", {
            count: "exact",
            head: true
        })
        .eq("user_id", user.id)
        .eq("is_active", true);

    if (countError) throw countError;

    if ((count || 0) >= MAX_ACTIVE_SESSIONS) {
        const error = new Error(
            "This Dino ID already has 2 active connections."
        );

        error.code = "SESSION_LIMIT";

        throw error;
    }

    const rawToken = makeToken();
    const tokenHash = hashToken(rawToken);

    const { data, error } = await supabase
        .from("sessions")
        .insert({
            user_id: user.id,
            dino_id: user.dino_id,
            session_token_hash: tokenHash,
            device_type: cleanString(deviceInfo.deviceType, 50),
            device_name: cleanString(deviceInfo.deviceName, 100),
            is_active: true
        })
        .select()
        .single();

    if (error) throw error;

    return {
        token: rawToken,
        session: data
    };
}

async function authenticateToken(token) {
    if (!token) return null;

    const tokenHash = hashToken(token);

    const { data: session, error: sessionError } = await supabase
        .from("sessions")
        .select("*")
        .eq("session_token_hash", tokenHash)
        .eq("is_active", true)
        .maybeSingle();

    if (sessionError) throw sessionError;

    if (!session) return null;

    const user = await findUserById(session.user_id);

    if (!user) return null;

    await supabase
        .from("sessions")
        .update({
            last_seen_at: new Date().toISOString()
        })
        .eq("id", session.id)
        .eq("is_active", true);

    return {
        user,
        session
    };
}

function getBearerToken(req) {
    const header = req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
        return null;
    }

    return header.slice(7).trim();
}

const requireAuth = asyncHandler(async (req, res, next) => {
    const token = getBearerToken(req);

    if (!token) {
        return res.status(401).json({
            error: "Authentication required."
        });
    }

    const auth = await authenticateToken(token);

    if (!auth) {
        return res.status(401).json({
            error: "Invalid or expired session."
        });
    }

    req.auth = auth;

    next();
});

// ============================================================
// HEALTH
// ============================================================

app.get(
    "/api/health",
    asyncHandler(async (req, res) => {
        const { error } = await supabase
            .from("users")
            .select("id")
            .limit(1);

        if (error) {
            return res.status(503).json({
                status: "error",
                database: "offline"
            });
        }

        res.json({
            status: "ok",
            database: "connected",
            service: "dinochat-server-v2",
            maxDinoScore: MAX_DINO_SCORE,
            maxActiveConnections: MAX_ACTIVE_SESSIONS,
            timestamp: new Date().toISOString()
        });
    })
);

// ============================================================
// REGISTER
// ============================================================

app.post(
    "/api/auth/register",
    asyncHandler(async (req, res) => {
        const username = normalizeUsername(req.body.username);

        if (!validUsername(username)) {
            return res.status(400).json({
                error:
                    "Username must be 2-32 characters and use letters, numbers, spaces, dots, hyphens or underscores."
            });
        }

        const dinoId = await createUniqueDinoId();

        const { data: user, error } = await supabase
            .from("users")
            .insert({
                dino_id: dinoId,
                username,
                dino_score: 0.10,
                score_tier: "D0.1",
                is_online: true,
                last_seen_at: new Date().toISOString()
            })
            .select()
            .single();

        if (error) {
            return res.status(500).json({
                error: "Could not create Dino account.",
                details: error.message
            });
        }

        await supabase
            .from("user_action_counters")
            .insert({
                user_id: user.id
            });

        const session = await createSession(user, {
            deviceType: req.headers["x-device-type"],
            deviceName: req.headers["x-device-name"]
        });

        res.status(201).json({
            user: publicUser(user),
            token: session.token,
            sessionLimit: MAX_ACTIVE_SESSIONS
        });
    })
);

// ============================================================
// LOGIN
// ============================================================

app.post(
    "/api/auth/login",
    asyncHandler(async (req, res) => {
        const dinoId = normalizeDinoId(req.body.dinoId);

        if (!dinoId) {
            return res.status(400).json({
                error: "Dino ID is required."
            });
        }

        const user = await findUserByDinoId(dinoId);

        if (!user) {
            return res.status(404).json({
                error: "Dino ID not found."
            });
        }

        try {
            const session = await createSession(user, {
                deviceType: req.headers["x-device-type"],
                deviceName: req.headers["x-device-name"]
            });

            await setOnline(user.id, true);

            res.json({
                user: publicUser(user),
                token: session.token,
                sessionLimit: MAX_ACTIVE_SESSIONS
            });
        } catch (error) {
            if (error.code === "SESSION_LIMIT") {
                return res.status(409).json({
                    error: error.message,
                    code: "SESSION_LIMIT",
                    limit: MAX_ACTIVE_SESSIONS
                });
            }

            throw error;
        }
    })
);

// ============================================================
// LOGOUT
// ============================================================

app.post(
    "/api/auth/logout",
    requireAuth,
    asyncHandler(async (req, res) => {
        const token = getBearerToken(req);
        const tokenHash = hashToken(token);

        await supabase
            .from("sessions")
            .update({
                is_active: false,
                disconnected_at: new Date().toISOString()
            })
            .eq("session_token_hash", tokenHash);

        const { count, error } = await supabase
            .from("sessions")
            .select("*", {
                count: "exact",
                head: true
            })
            .eq("user_id", req.auth.user.id)
            .eq("is_active", true);

        if (!error && (count || 0) === 0) {
            await setOnline(req.auth.user.id, false);
        }

        res.json({
            success: true
        });
    })
);

// ============================================================
// ACCOUNT
// ============================================================

app.get(
    "/api/account",
    requireAuth,
    asyncHandler(async (req, res) => {
        const user = await findUserById(req.auth.user.id);

        const ranking = await getUserRanking(user.id);

        const { data: achievements } = await supabase
            .from("user_achievements")
            .select(`
                earned_at,
                achievements (
                    achievement_key,
                    name,
                    description,
                    icon,
                    category
                )
            `)
            .eq("user_id", user.id)
            .order("earned_at", {
                ascending: false
            });

        const { data: layouts } = await supabase
            .from("user_layouts")
            .select("*")
            .eq("user_id", user.id)
            .maybeSingle();

        res.json({
            user: publicUser(user),
            rank: ranking,
            achievements: achievements || [],
            layout: layouts || {
                layout_name: "classic",
                layout_data: {}
            }
        });
    })
);

// ============================================================
// UPDATE USERNAME
// ============================================================

app.put(
    "/api/account/username",
    requireAuth,
    asyncHandler(async (req, res) => {
        const username = normalizeUsername(req.body.username);

        if (!validUsername(username)) {
            return res.status(400).json({
                error: "Invalid username."
            });
        }

        const { data: user, error } = await supabase
            .from("users")
            .update({
                username
            })
            .eq("id", req.auth.user.id)
            .select()
            .single();

        if (error) {
            return res.status(500).json({
                error: "Could not update username."
            });
        }

        res.json({
            user: publicUser(user)
        });
    })
);

// ============================================================
// PROFILE BY DINO ID
// ============================================================

app.get(
    "/api/dino/:dinoId",
    requireAuth,
    asyncHandler(async (req, res) => {
        const user = await findUserByDinoId(
            req.params.dinoId
        );

        if (!user) {
            return res.status(404).json({
                error: "Dino ID not found."
            });
        }

        const rank = await getUserRanking(user.id);

        const { data: achievements } = await supabase
            .from("user_achievements")
            .select(`
                earned_at,
                achievements (
                    achievement_key,
                    name,
                    description,
                    icon,
                    category
                )
            `)
            .eq("user_id", user.id)
            .order("earned_at", {
                ascending: false
            });

        res.json({
            user: publicUser(user),
            rank,
            achievements: achievements || []
        });
    })
);

// ============================================================
// ONLINE STATE
// ============================================================

async function setOnline(userId, online) {
    await supabase
        .from("users")
        .update({
            is_online: online,
            last_seen_at: new Date().toISOString()
        })
        .eq("id", userId);
}

// ============================================================
// MESSAGES
// ============================================================

app.get(
    "/api/messages",
    requireAuth,
    asyncHandler(async (req, res) => {
        const limit = Math.min(
            Math.max(Number(req.query.limit) || 100, 1),
            200
        );

        const { data, error } = await supabase
            .from("messages")
            .select("*")
            .is("deleted_at", null)
            .order("created_at", {
                ascending: false
            })
            .limit(limit);

        if (error) {
            return res.status(500).json({
                error: "Could not load messages."
            });
        }

        res.json({
            messages: (data || []).reverse()
        });
    })
);

app.post(
    "/api/messages",
    requireAuth,
    asyncHandler(async (req, res) => {
        const content = cleanString(req.body.content, 5000);

        if (!content) {
            return res.status(400).json({
                error: "Message cannot be empty."
            });
        }

        const user = req.auth.user;

        const { data: message, error } = await supabase
            .from("messages")
            .insert({
                sender_id: user.id,
                sender_dino_id: user.dino_id,
                content
            })
            .select()
            .single();

        if (error) {
            return res.status(500).json({
                error: "Could not send message."
            });
        }

        await incrementAction(
            user.id,
            "messages_count"
        );

        await rewardForCounter(
            user.id,
            "messages_count",
            "last_message_reward_count",
            100,
            0.10
        );

        io.to("dinosaur").emit(
            "new-message",
            message
        );

        res.status(201).json({
            message
        });
    })
);

app.put(
    "/api/messages/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
        const content = cleanString(req.body.content, 5000);

        if (!content) {
            return res.status(400).json({
                error: "Message cannot be empty."
            });
        }

        const { data: existing } = await supabase
            .from("messages")
            .select("*")
            .eq("id", req.params.id)
            .maybeSingle();

        if (!existing) {
            return res.status(404).json({
                error: "Message not found."
            });
        }

        if (existing.sender_id !== req.auth.user.id) {
            return res.status(403).json({
                error: "You can only edit your own message."
            });
        }

        const { data: message, error } = await supabase
            .from("messages")
            .update({
                content,
                edited_at: new Date().toISOString()
            })
            .eq("id", req.params.id)
            .select()
            .single();

        if (error) {
            return res.status(500).json({
                error: "Could not edit message."
            });
        }

        io.to("dinosaur").emit(
            "message-edited",
            message
        );

        res.json({
            message
        });
    })
);

app.delete(
    "/api/messages/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
        const { data: existing } = await supabase
            .from("messages")
            .select("*")
            .eq("id", req.params.id)
            .maybeSingle();

        if (!existing) {
            return res.status(404).json({
                error: "Message not found."
            });
        }

        if (existing.sender_id !== req.auth.user.id) {
            return res.status(403).json({
                error: "You can only delete your own message."
            });
        }

        await supabase
            .from("messages")
            .update({
                deleted_at: new Date().toISOString()
            })
            .eq("id", req.params.id);

        io.to("dinosaur").emit(
            "message-deleted",
            {
                id: req.params.id
            }
        );

        res.json({
            success: true
        });
    })
);

// ============================================================
// LIVE DINO RANKINGS
// ============================================================

async function getRankings(limit = 100) {
    const safeLimit = Math.min(
        Math.max(Number(limit) || 100, 1),
        1000
    );

    const { data, error } = await supabase
        .from("live_dino_rankings")
        .select("*")
        .order("rank_position", {
            ascending: true
        })
        .limit(safeLimit);

    if (error) throw error;

    return data || [];
}

async function getUserRanking(userId) {
    const { data: user } = await supabase
        .from("users")
        .select("id,dino_score,created_at")
        .eq("id", userId)
        .maybeSingle();

    if (!user) return null;

    /*
    Ranking:
      higher score first
      older account wins ties
    */

    const { count, error } = await supabase
        .from("users")
        .select("*", {
            count: "exact",
            head: true
        })
        .or(
            `dino_score.gt.${user.dino_score},and(dino_score.eq.${user.dino_score},created_at.lt.${user.created_at})`
        );

    if (error) throw error;

    return {
        position: (count || 0) + 1,
        score: user.dino_score
    };
}

app.get(
    "/api/scores",
    requireAuth,
    asyncHandler(async (req, res) => {
        const rankings = await getRankings(
            req.query.limit
        );

        const ownRank = await getUserRanking(
            req.auth.user.id
        );

        res.json({
            rankings,
            ownRank,
            maxScore: MAX_DINO_SCORE
        });
    })
);

// ============================================================
// SCORE UPDATE
// ============================================================

async function updateScore(userId, amount) {
    const user = await findUserById(userId);

    if (!user) {
        throw new Error("User not found.");
    }

    /*
    Once Dino1000 is reached, score cannot increase further.
    */

    if (
        Number(user.dino_score) >= MAX_DINO_SCORE &&
        amount > 0
    ) {
        return user;
    }

    const newScore = amount >= 0
        ? scoreReward(user.dino_score, amount)
        : subtractScore(user.dino_score, Math.abs(amount));

    const tier = calculateTier(newScore);

    const { data, error } = await supabase
        .from("users")
        .update({
            dino_score: newScore,
            score_tier: tier
        })
        .eq("id", userId)
        .select()
        .single();

    if (error) throw error;

    io.to(`user:${userId}`).emit(
        "score-updated",
        {
            dinoScore: data.dino_score,
            scoreTier: data.score_tier
        }
    );

    return data;
}

// ============================================================
// ACTION COUNTERS
// ============================================================

async function incrementAction(userId, column) {
    const { data: counter } = await supabase
        .from("user_action_counters")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

    if (!counter) {
        await supabase
            .from("user_action_counters")
            .insert({
                user_id: userId,
                [column]: 1
            });

        return;
    }

    await supabase
        .from("user_action_counters")
        .update({
            [column]: Number(counter[column] || 0) + 1,
            updated_at: new Date().toISOString()
        })
        .eq("user_id", userId);
}

async function rewardForCounter(
    userId,
    countColumn,
    rewardColumn,
    interval,
    reward
) {
    const { data: counter } = await supabase
        .from("user_action_counters")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

    if (!counter) return;

    const current = Number(
        counter[countColumn] || 0
    );

    const previousRewardCount = Number(
        counter[rewardColumn] || 0
    );

    const availableRewards =
        Math.floor(current / interval);

    const alreadyGiven =
        Math.floor(previousRewardCount / interval);

    const rewardsToGive =
        availableRewards - alreadyGiven;

    if (rewardsToGive <= 0) return;

    await updateScore(
        userId,
        reward * rewardsToGive
    );

    await supabase
        .from("user_action_counters")
        .update({
            [rewardColumn]: current,
            updated_at: new Date().toISOString()
        })
        .eq("user_id", userId);
}

// ============================================================
// SNAP COUNTER
// ============================================================

app.post(
    "/api/actions/snap",
    requireAuth,
    asyncHandler(async (req, res) => {
        const userId = req.auth.user.id;

        await incrementAction(
            userId,
            "snaps_count"
        );

        const { data: user } = await supabase
            .from("users")
            .select("total_snaps")
            .eq("id", userId)
            .single();

        await supabase
            .from("users")
            .update({
                total_snaps:
                    Number(user.total_snaps || 0) + 1
            })
            .eq("id", userId);

        await rewardForCounter(
            userId,
            "snaps_count",
            "last_snap_reward_count",
            10,
            0.10
        );

        await awardAchievement(
            userId,
            "snap_10"
        );

        const { data: counter } = await supabase
            .from("user_action_counters")
            .select("snaps_count")
            .eq("user_id", userId)
            .single();

        if (
            Number(counter?.snaps_count || 0) >= 50
        ) {
            await awardAchievement(
                userId,
                "snap_50"
            );
        }

        res.json({
            success: true
        });
    })
);

// ============================================================
// PHOTO COUNTER
// ============================================================

app.post(
    "/api/actions/photo",
    requireAuth,
    asyncHandler(async (req, res) => {
        const userId = req.auth.user.id;

        await incrementAction(
            userId,
            "photos_count"
        );

        const { data: user } = await supabase
            .from("users")
            .select("total_photos")
            .eq("id", userId)
            .single();

        await supabase
            .from("users")
            .update({
                total_photos:
                    Number(user.total_photos || 0) + 1
            })
            .eq("id", userId);

        await rewardForCounter(
            userId,
            "photos_count",
            "last_photo_reward_count",
            50,
            0.10
        );

        await awardAchievement(
            userId,
            "photo_50"
        );

        res.json({
            success: true
        });
    })
);

// ============================================================
// ACHIEVEMENTS
// ============================================================

async function awardAchievement(
    userId,
    achievementKey
) {
    const { data: achievement } = await supabase
        .from("achievements")
        .select("*")
        .eq("achievement_key", achievementKey)
        .maybeSingle();

    if (!achievement) return false;

    const { data: existing } = await supabase
        .from("user_achievements")
        .select("id")
        .eq("user_id", userId)
        .eq("achievement_id", achievement.id)
        .maybeSingle();

    if (existing) {
        return false;
    }

    const { error } = await supabase
        .from("user_achievements")
        .insert({
            user_id: userId,
            achievement_id: achievement.id
        });

    if (error) return false;

    io.to(`user:${userId}`).emit(
        "achievement-earned",
        achievement
    );

    return true;
}

async function checkScoreAchievements(userId) {
    const user = await findUserById(userId);

    if (!user) return;

    const rank = await getUserRanking(userId);

    if (rank && rank.position <= 3) {
        await awardAchievement(
            userId,
            "dino_top_3"
        );
    }

    if (Number(user.dino_score) >= 100) {
        await awardAchievement(
            userId,
            "dino_100"
        );
    }

    if (Number(user.dino_score) >= 1000) {
        await awardAchievement(
            userId,
            "dino_1000"
        );
    }
}

// ============================================================
// FRIEND REQUESTS
// ============================================================

app.post(
    "/api/friends/request",
    requireAuth,
    asyncHandler(async (req, res) => {
        const targetDinoId = normalizeDinoId(
            req.body.dinoId
        );

        if (!targetDinoId) {
            return res.status(400).json({
                error: "Dino ID is required."
            });
        }

        const target = await findUserByDinoId(
            targetDinoId
        );

        if (!target) {
            return res.status(404).json({
                error: "Dino ID not found."
            });
        }

        if (target.id === req.auth.user.id) {
            return res.status(400).json({
                error: "You cannot add yourself."
            });
        }

        const { data: existing } = await supabase
            .from("friend_requests")
            .select("*")
            .or(
                `and(sender_id.eq.${req.auth.user.id},receiver_id.eq.${target.id}),and(sender_id.eq.${target.id},receiver_id.eq.${req.auth.user.id})`
            )
            .maybeSingle();

        if (existing) {
            return res.status(409).json({
                error: "A friend request already exists."
            });
        }

        const { data: request, error } = await supabase
            .from("friend_requests")
            .insert({
                sender_id: req.auth.user.id,
                receiver_id: target.id
            })
            .select()
            .single();

        if (error) {
            return res.status(500).json({
                error: "Could not send friend request."
            });
        }

        io.to(`user:${target.id}`).emit(
            "friend-request",
            request
        );

        res.status(201).json({
            request
        });
    })
);

// ============================================================
// ACCEPT FRIEND REQUEST
// ============================================================

app.post(
    "/api/friends/:requestId/accept",
    requireAuth,
    asyncHandler(async (req, res) => {
        const { data: request } = await supabase
            .from("friend_requests")
            .select("*")
            .eq("id", req.params.requestId)
            .maybeSingle();

        if (!request) {
            return res.status(404).json({
                error: "Friend request not found."
            });
        }

        if (request.receiver_id !== req.auth.user.id) {
            return res.status(403).json({
                error: "This request is not yours."
            });
        }

        await supabase
            .from("friend_requests")
            .update({
                status: "accepted",
                responded_at: new Date().toISOString()
            })
            .eq("id", request.id);

        /*
        Normalize ordering so A/B cannot create duplicates.
        */

        const [userA, userB] =
            [request.sender_id, request.receiver_id]
                .sort();

        const { data: friendship } =
            await supabase
                .from("friendships")
                .insert({
                    user_a: userA,
                    user_b: userB
                })
                .select()
                .single();

        await awardAchievement(
            req.auth.user.id,
            "first_friend"
        );

        io.to(`user:${request.sender_id}`).emit(
            "friend-accepted",
            friendship
        );

        res.json({
            friendship
        });
    })
);

// ============================================================
// FRIEND LIST
// ============================================================

app.get(
    "/api/friends",
    requireAuth,
    asyncHandler(async (req, res) => {
        const userId = req.auth.user.id;

        const { data: friendships, error } =
            await supabase
                .from("friendships")
                .select("*")
                .or(
                    `user_a.eq.${userId},user_b.eq.${userId}`
                );

        if (error) {
            return res.status(500).json({
                error: "Could not load friends."
            });
        }

        const friends = [];

        for (const friendship of friendships || []) {
            const friendId =
                friendship.user_a === userId
                    ? friendship.user_b
                    : friendship.user_a;

            const friend =
                await findUserById(friendId);

            if (friend) {
                friends.push(publicUser(friend));
            }
        }

        res.json({
            friends
        });
    })
);

// ============================================================
// SCORE TRANSFER
// ============================================================

app.post(
    "/api/scores/send",
    requireAuth,
    asyncHandler(async (req, res) => {
        const targetDinoId = normalizeDinoId(
            req.body.dinoId
        );

        const amount = Number(req.body.amount);

        if (!targetDinoId || !Number.isFinite(amount)) {
            return res.status(400).json({
                error: "Dino ID and valid amount are required."
            });
        }

        if (amount <= 0) {
            return res.status(400).json({
                error: "Amount must be greater than zero."
            });
        }

        const sender = await findUserById(
            req.auth.user.id
        );

        const receiver =
            await findUserByDinoId(targetDinoId);

        if (!receiver) {
            return res.status(404).json({
                error: "Receiver Dino ID not found."
            });
        }

        if (sender.id === receiver.id) {
            return res.status(400).json({
                error: "You cannot send Dino Score to yourself."
            });
        }

        if (Number(sender.dino_score) < amount) {
            return res.status(400).json({
                error: "Not enough Dino Score."
            });
        }

        /*
        Transfer in sequence.

        In a production setup this should ideally be a single
        PostgreSQL transaction/RPC to guarantee atomicity.
        */

        const senderScore =
            subtractScore(
                sender.dino_score,
                amount
            );

        const receiverScore =
            scoreReward(
                receiver.dino_score,
                amount
            );

        await supabase
            .from("users")
            .update({
                dino_score: senderScore,
                score_tier: calculateTier(senderScore),
                scores_sent:
                    Number(sender.scores_sent || 0) + amount
            })
            .eq("id", sender.id);

        await supabase
            .from("users")
            .update({
                dino_score: receiverScore,
                score_tier: calculateTier(receiverScore),
                scores_received:
                    Number(receiver.scores_received || 0) + amount
            })
            .eq("id", receiver.id);

        const { data: transfer, error } =
            await supabase
                .from("score_transfers")
                .insert({
                    sender_id: sender.id,
                    receiver_id: receiver.id,
                    amount,
                    note: cleanString(
                        req.body.note,
                        300
                    )
                })
                .select()
                .single();

        if (error) {
            return res.status(500).json({
                error: "Transfer record could not be created."
            });
        }

        await awardAchievement(
            sender.id,
            "score_sender"
        );

        await checkScoreAchievements(
            sender.id
        );

        await checkScoreAchievements(
            receiver.id
        );

        io.to(`user:${sender.id}`).emit(
            "score-updated",
            {
                dinoScore: senderScore,
                scoreTier: calculateTier(senderScore)
            }
        );

        io.to(`user:${receiver.id}`).emit(
            "score-received",
            {
                fromDinoId: sender.dino_id,
                amount,
                dinoScore: receiverScore
            }
        );

        res.json({
            success: true,
            transfer,
            senderScore,
            receiverScore
        });
    })
);

// ============================================================
// SOCIAL LINK VALIDATION
// ============================================================

function validateSocialUrl(
    type,
    rawUrl
) {
    try {
        const url = new URL(rawUrl);

        if (
            url.protocol !== "https:" &&
            url.protocol !== "http:"
        ) {
            return null;
        }

        const hostname =
            url.hostname.toLowerCase();

        if (type === "instagram") {
            const valid =
                hostname === "instagram.com" ||
                hostname.endsWith(".instagram.com");

            return valid
                ? url.toString()
                : null;
        }

        if (type === "snap") {
            const valid =
                hostname === "snapchat.com" ||
                hostname.endsWith(".snapchat.com");

            return valid
                ? url.toString()
                : null;
        }

        return null;
    } catch {
        return null;
    }
}

// ============================================================
// CREATE SOCIAL CONTENT
// ============================================================

app.post(
    "/api/social",
    requireAuth,
    asyncHandler(async (req, res) => {
        const type = cleanString(
            req.body.type,
            30
        ).toLowerCase();

        const url = cleanString(
            req.body.url,
            2000
        );

        if (
            type !== "instagram" &&
            type !== "snap"
        ) {
            return res.status(400).json({
                error: "Supported types are instagram and snap."
            });
        }

        const verifiedUrl =
            validateSocialUrl(
                type,
                url
            );

        if (!verifiedUrl) {
            return res.status(400).json({
                error:
                    "This does not appear to be a supported Instagram or Snapchat URL."
            });
        }

        const { data: content, error } =
            await supabase
                .from("social_content")
                .insert({
                    owner_id: req.auth.user.id,
                    owner_dino_id:
                        req.auth.user.dino_id,
                    content_type: type,
                    original_url: url,
                    verified_url: verifiedUrl,
                    is_verified: true
                })
                .select()
                .single();

        if (error) {
            return res.status(500).json({
                error: "Could not save social content."
            });
        }

        res.status(201).json({
            content
        });
    })
);

// ============================================================
// SOCIAL VIEW
// ============================================================

app.post(
    "/api/social/:id/view",
    requireAuth,
    asyncHandler(async (req, res) => {
        const { data: content } =
            await supabase
                .from("social_content")
                .select("*")
                .eq("id", req.params.id)
                .maybeSingle();

        if (!content) {
            return res.status(404).json({
                error: "Social content not found."
            });
        }

        if (!content.is_verified) {
            return res.status(400).json({
                error: "Content is not verified."
            });
        }

        /*
        Unique view = unique Dino ID.

        Refreshing does not create another unique view.
        */

        const { data: existing } =
            await supabase
                .from("social_views")
                .select("id")
                .eq("content_id", content.id)
                .eq("viewer_id", req.auth.user.id)
                .maybeSingle();

        if (!existing) {
            await supabase
                .from("social_views")
                .insert({
                    content_id: content.id,
                    viewer_id: req.auth.user.id
                });

            await supabase
                .from("social_content")
                .update({
                    total_views:
                        Number(content.total_views || 0) + 1,
                    unique_views:
                        Number(content.unique_views || 0) + 1
                })
                .eq("id", content.id);

            await supabase
                .from("users")
                .update({
                    total_social_views:
                        Number(
                            req.auth.user.total_social_views || 0
                        ) + 1,
                    unique_social_views:
                        Number(
                            req.auth.user.unique_social_views || 0
                        ) + 1
                })
                .eq("id", content.owner_id);

            const { count } = await supabase
                .from("users")
                .select("*", {
                    count: "exact",
                    head: true
                })
                .eq(
                    "id",
                    content.owner_id
                );

            if (count) {
                await awardAchievement(
                    content.owner_id,
                    "social_views_100"
                );
            }
        }

        res.json({
            success: true,
            uniqueView: !existing,
            url: content.verified_url
        });
    })
);

// ============================================================
// SOCIAL CONTENT LIST
// ============================================================

app.get(
    "/api/social",
    requireAuth,
    asyncHandler(async (req, res) => {
        const type = cleanString(
            req.query.type,
            30
        ).toLowerCase();

        let query = supabase
            .from("social_content")
            .select("*")
            .eq("is_verified", true)
            .order("created_at", {
                ascending: false
            })
            .limit(100);

        if (
            type === "instagram" ||
            type === "snap"
        ) {
            query = query.eq(
                "content_type",
                type
            );
        }

        const { data, error } = await query;

        if (error) {
            return res.status(500).json({
                error: "Could not load social content."
            });
        }

        res.json({
            content: data || []
        });
    })
);

// ============================================================
// LAYOUT CUSTOMIZATION
// ============================================================

const DEFAULT_LAYOUTS = {
    classic: {
        sidebar: "left",
        chat: "center",
        profile: "right",
        actions: "bottom"
    },

    compact: {
        sidebar: "left",
        chat: "center",
        profile: "drawer",
        actions: "top"
    },

    chatFirst: {
        sidebar: "drawer",
        chat: "center",
        profile: "right",
        actions: "bottom"
    },

    profileFirst: {
        sidebar: "right",
        chat: "center",
        profile: "left",
        actions: "bottom"
    },

    mobileBar: {
        sidebar: "drawer",
        chat: "center",
        profile: "drawer",
        actions: "bottom"
    },

    wideChat: {
        sidebar: "left",
        chat: "wide",
        profile: "drawer",
        actions: "top"
    },

    actionFocus: {
        sidebar: "left",
        chat: "center",
        profile: "drawer",
        actions: "right"
    },

    minimal: {
        sidebar: "drawer",
        chat: "wide",
        profile: "drawer",
        actions: "bottom"
    },

    split: {
        sidebar: "left",
        chat: "center",
        profile: "right",
        actions: "right"
    },

    dashboard: {
        sidebar: "left",
        chat: "center",
        profile: "right",
        actions: "top"
    }
};

app.get(
    "/api/layouts",
    requireAuth,
    asyncHandler(async (req, res) => {
        res.json({
            layouts: DEFAULT_LAYOUTS
        });
    })
);

app.get(
    "/api/layout",
    requireAuth,
    asyncHandler(async (req, res) => {
        const { data } = await supabase
            .from("user_layouts")
            .select("*")
            .eq("user_id", req.auth.user.id)
            .maybeSingle();

        res.json({
            layout: data || {
                layout_name: "classic",
                layout_data: DEFAULT_LAYOUTS.classic
            }
        });
    })
);

app.put(
    "/api/layout",
    requireAuth,
    asyncHandler(async (req, res) => {
        const layoutName = cleanString(
            req.body.layoutName,
            50
        );

        if (!DEFAULT_LAYOUTS[layoutName]) {
            return res.status(400).json({
                error: "Unknown layout."
            });
        }

        const layoutData =
            DEFAULT_LAYOUTS[layoutName];

        const { data, error } =
            await supabase
                .from("user_layouts")
                .upsert(
                    {
                        user_id:
                            req.auth.user.id,
                        layout_name:
                            layoutName,
                        layout_data:
                            layoutData
                    },
                    {
                        onConflict: "user_id"
                    }
                )
                .select()
                .single();

        if (error) {
            return res.status(500).json({
                error: "Could not save layout."
            });
        }

        res.json({
            layout: data
        });
    })
);

// ============================================================
// CHESS BETS
// ============================================================

app.post(
    "/api/bets/chess",
    requireAuth,
    asyncHandler(async (req, res) => {
        const stake = Number(
            req.body.stake
        );

        if (
            !Number.isFinite(stake) ||
            stake <= 0
        ) {
            return res.status(400).json({
                error: "Invalid Dino Score stake."
            });
        }

        const user = req.auth.user;

        if (
            Number(user.dino_score) < stake
        ) {
            return res.status(400).json({
                error: "You do not have enough Dino Score."
            });
        }

        const { data: bet, error } =
            await supabase
                .from("chess_bets")
                .insert({
                    creator_id: user.id,
                    creator_dino_id:
                        user.dino_id,
                    stake,
                    status: "waiting"
                })
                .select()
                .single();

        if (error) {
            return res.status(500).json({
                error: "Could not create chess bet."
            });
        }

        io.emit(
            "new-chess-bet",
            bet
        );

        res.status(201).json({
            bet
        });
    })
);

// ============================================================
// ACCEPT CHESS BET
// ============================================================

app.post(
    "/api/bets/chess/:id/accept",
    requireAuth,
    asyncHandler(async (req, res) => {
        const { data: bet } =
            await supabase
                .from("chess_bets")
                .select("*")
                .eq("id", req.params.id)
                .maybeSingle();

        if (!bet) {
            return res.status(404).json({
                error: "Bet not found."
            });
        }

        if (bet.status !== "waiting") {
            return res.status(409).json({
                error: "This bet is no longer available."
            });
        }

        if (
            bet.creator_id === req.auth.user.id
        ) {
            return res.status(400).json({
                error: "You cannot accept your own bet."
            });
        }

        const opponent = req.auth.user;

        if (
            Number(opponent.dino_score) < Number(bet.stake)
        ) {
            return res.status(400).json({
                error: "You do not have enough Dino Score for this bet."
            });
        }

        const { data: updatedBet, error } =
            await supabase
                .from("chess_bets")
                .update({
                    opponent_id: opponent.id,
                    opponent_dino_id:
                        opponent.dino_id,
                    status: "accepted",
                    accepted_at:
                        new Date().toISOString()
                })
                .eq("id", bet.id)
                .eq("status", "waiting")
                .select()
                .single();

        if (error) {
            return res.status(500).json({
                error: "Could not accept bet."
            });
        }

        io.emit(
            "chess-bet-accepted",
            updatedBet
        );

        res.json({
            bet: updatedBet
        });
    })
);

// ============================================================
// COMPLETE CHESS BET
// ============================================================

app.post(
    "/api/bets/chess/:id/complete",
    requireAuth,
    asyncHandler(async (req, res) => {
        const winnerDinoId =
            normalizeDinoId(
                req.body.winnerDinoId
            );

        const { data: bet } =
            await supabase
                .from("chess_bets")
                .select("*")
                .eq("id", req.params.id)
                .maybeSingle();

        if (!bet) {
            return res.status(404).json({
                error: "Bet not found."
            });
        }

        if (
            bet.status !== "accepted" &&
            bet.status !== "active"
        ) {
            return res.status(409).json({
                error: "Bet cannot be completed."
            });
        }

        const creator =
            await findUserById(
                bet.creator_id
            );

        const opponent =
            await findUserById(
                bet.opponent_id
            );

        const winner =
            await findUserByDinoId(
                winnerDinoId
            );

        if (
            !creator ||
            !opponent ||
            !winner
        ) {
            return res.status(400).json({
                error: "Invalid players."
            });
        }

        if (
            winner.id !== creator.id &&
            winner.id !== opponent.id
        ) {
            return res.status(400).json({
                error: "Winner must be one of the players."
            });
        }

        /*
        Each player pays the stake.

        Winner receives both stakes.

        The user's requested negative-score behavior is
        supported here.
        */

        const stake =
            Number(bet.stake);

        const creatorNewScore =
            subtractScore(
                creator.dino_score,
                stake
            );

        const opponentNewScore =
            subtractScore(
                opponent.dino_score,
                stake
            );

        const winnerStartingScore =
            winner.id === creator.id
                ? creatorNewScore
                : opponentNewScore;

        const winnerFinalScore =
            scoreReward(
                winnerStartingScore,
                stake * 2
            );

        const loser =
            winner.id === creator.id
                ? opponent
                : creator;

        const loserFinalScore =
            winner.id === creator.id
                ? opponentNewScore
                : creatorNewScore;

        await supabase
            .from("users")
            .update({
                dino_score:
                    winnerFinalScore,
                score_tier:
                    calculateTier(
                        winnerFinalScore
                    )
            })
            .eq("id", winner.id);

        await supabase
            .from("users")
            .update({
                dino_score:
                    loserFinalScore,
                score_tier:
                    calculateTier(
                        loserFinalScore
                    )
            })
            .eq("id", loser.id);

        await supabase
            .from("chess_bets")
            .update({
                status: "completed",
                winner_id: winner.id,
                completed_at:
                    new Date().toISOString()
            })
            .eq("id", bet.id);

        await supabase
            .from("bet_transactions")
            .insert([
                {
                    bet_id: bet.id,
                    user_id: creator.id,
                    amount: -stake,
                    transaction_type:
                        "stake"
                },
                {
                    bet_id: bet.id,
                    user_id: opponent.id,
                    amount: -stake,
                    transaction_type:
                        "stake"
                },
                {
                    bet_id: bet.id,
                    user_id: winner.id,
                    amount: stake * 2,
                    transaction_type:
                        "win"
                }
            ]);

        await awardAchievement(
            winner.id,
            "first_chess_win"
        );

        await checkScoreAchievements(
            winner.id
        );

        await checkScoreAchievements(
            loser.id
        );

        io.to(`user:${winner.id}`).emit(
            "chess-result",
            {
                result: "win",
                amount: stake * 2
            }
        );

        io.to(`user:${loser.id}`).emit(
            "chess-result",
            {
                result: "loss",
                amount: stake
            }
        );

        res.json({
            success: true,
            winnerDinoId: winner.dino_id,
            stake,
            winnerScore: winnerFinalScore,
            loserScore: loserFinalScore
        });
    })
);

// ============================================================
// BET LIST
// ============================================================

app.get(
    "/api/bets/chess",
    requireAuth,
    asyncHandler(async (req, res) => {
        const { data, error } =
            await supabase
                .from("chess_bets")
                .select("*")
                .in("status", [
                    "waiting",
                    "accepted",
                    "active"
                ])
                .order("created_at", {
                    ascending: false
                })
                .limit(100);

        if (error) {
            return res.status(500).json({
                error: "Could not load chess bets."
            });
        }

        res.json({
            bets: data || []
        });
    })
);

// ============================================================
// DAILY RANKING
// ============================================================

async function captureDailyRanking() {
    const today =
        new Date()
            .toISOString()
            .slice(0, 10);

    const rankings =
        await getRankings(100);

    for (
        let index = 0;
        index < rankings.length;
        index++
    ) {
        const ranking = rankings[index];

        await supabase
            .from("daily_rankings")
            .upsert(
                {
                    ranking_date: today,
                    user_id: ranking.id,
                    dino_id: ranking.dino_id,
                    rank_position:
                        index + 1,
                    score:
                        ranking.dino_score
                },
                {
                    onConflict:
                        "ranking_date,rank_position"
                }
            );
    }

    /*
    #1 gets Dino of the Day only after the day's
    ranking has been captured.

    This prevents awarding it simply because somebody
    temporarily reached #1.
    */

    if (rankings.length > 0) {
        await awardAchievement(
            rankings[0].id,
            "dino_of_day"
        );
    }
}

// ============================================================
// DAILY RANKING INTERVAL
// ============================================================

setInterval(
    () => {
        captureDailyRanking()
            .catch(error => {
                console.error(
                    "Daily ranking error:",
                    error.message
                );
            });
    },
    60 * 60 * 1000
);

// ============================================================
// PUBLIC USER
// ============================================================

function publicUser(user) {
    return {
        id: user.id,
        dinoId: user.dino_id,
        username: user.username,

        dinoScore: user.dino_score,
        scoreTier:
            user.score_tier ||
            calculateTier(user.dino_score),

        totalMessages:
            user.total_messages,

        totalSnaps:
            user.total_snaps,

        totalPhotos:
            user.total_photos,

        totalSocialViews:
            user.total_social_views,

        uniqueSocialViews:
            user.unique_social_views,

        scoresSent:
            user.scores_sent,

        scoresReceived:
            user.scores_received,

        createdAt:
            user.created_at,

        lastSeenAt:
            user.last_seen_at,

        isOnline:
            user.is_online
    };
}

// ============================================================
// SOCKET AUTH
// ============================================================

io.use(async (socket, next) => {
    try {
        const token =
            socket.handshake.auth?.token ||
            socket.handshake.headers?.authorization
                ?.replace(/^Bearer /, "");

        if (!token) {
            return next(
                new Error(
                    "Authentication required."
                )
            );
        }

        const auth =
            await authenticateToken(token);

        if (!auth) {
            return next(
                new Error(
                    "Invalid session."
                )
            );
        }

        socket.authData = auth;

        next();
    } catch (error) {
        next(error);
    }
});

// ============================================================
// SOCKET CONNECTION
// ============================================================

io.on("connection", async socket => {
    const user =
        socket.authData.user;

    const userRoom =
        `user:${user.id}`;

    socket.join(userRoom);

    socket.on(
        "join-dinosaur",
        () => {
            socket.join("dinosaur");

            setOnline(
                user.id,
                true
            ).catch(() => {});

            socket.emit(
                "joined-dinosaur",
                {
                    dinoId:
                        user.dino_id
                }
            );

            io.to("dinosaur").emit(
                "user-online",
                {
                    dinoId:
                        user.dino_id
                }
            );
        }
    );

    socket.on(
        "send-message",
        async payload => {
            try {
                const content =
                    cleanString(
                        payload?.content,
                        5000
                    );

                if (!content) return;

                const { data: message, error } =
                    await supabase
                        .from("messages")
                        .insert({
                            sender_id:
                                user.id,
                            sender_dino_id:
                                user.dino_id,
                            content
                        })
                        .select()
                        .single();

                if (error) {
                    socket.emit(
                        "message-error",
                        {
                            error:
                                "Message could not be sent."
                        }
                    );

                    return;
                }

                await incrementAction(
                    user.id,
                    "messages_count"
                );

                await rewardForCounter(
                    user.id,
                    "messages_count",
                    "last_message_reward_count",
                    100,
                    0.10
                );

                await checkScoreAchievements(
                    user.id
                );

                io.to("dinosaur").emit(
                    "new-message",
                    message
                );
            } catch (error) {
                socket.emit(
                    "message-error",
                    {
                        error:
                            "Unexpected message error."
                    }
                );
            }
        }
    );

    socket.on(
        "delete-message",
        async messageId => {
            try {
                const { data: message } =
                    await supabase
                        .from("messages")
                        .select("*")
                        .eq("id", messageId)
                        .maybeSingle();

                if (!message) return;

                if (
                    message.sender_id !==
                    user.id
                ) {
                    return;
                }

                await supabase
                    .from("messages")
                    .update({
                        deleted_at:
                            new Date().toISOString()
                    })
                    .eq("id", messageId);

                io.to("dinosaur").emit(
                    "message-deleted",
                    {
                        id: messageId
                    }
                );
            } catch {
                // Ignore socket deletion failures.
            }
        }
    );

    socket.on(
        "disconnect",
        async () => {
            try {
                const token =
                    socket.handshake.auth?.token;

                if (token) {
                    const tokenHash =
                        hashToken(token);

                    await supabase
                        .from("sessions")
                        .update({
                            is_active: false,
                            disconnected_at:
                                new Date().toISOString()
                        })
                        .eq(
                            "session_token_hash",
                            tokenHash
                        );
                }

                const { count } =
                    await supabase
                        .from("sessions")
                        .select("*", {
                            count: "exact",
                            head: true
                        })
                        .eq(
                            "user_id",
                            user.id
                        )
                        .eq(
                            "is_active",
                            true
                        );

                if ((count || 0) === 0) {
                    await setOnline(
                        user.id,
                        false
                    );

                    io.to("dinosaur").emit(
                        "user-offline",
                        {
                            dinoId:
                                user.dino_id
                        }
                    );
                }
            } catch {
                // Connection cleanup should never crash server.
            }
        }
    );
});

// ============================================================
// ERROR HANDLER
// ============================================================

app.use(
    (error, req, res, next) => {
        console.error(
            "SERVER ERROR:",
            error
        );

        if (res.headersSent) {
            return next(error);
        }

        res.status(500).json({
            error:
                "Internal server error."
        });
    }
);

// ============================================================
// START
// ============================================================

httpServer.listen(
    PORT,
    () => {
        console.log(
            `DinoChat server v2 running on port ${PORT}`
        );

        console.log(
            `Maximum Dino Score: Dino${MAX_DINO_SCORE}`
        );

        console.log(
            `Maximum active connections per Dino ID: ${MAX_ACTIVE_SESSIONS}`
        );
    }
);
