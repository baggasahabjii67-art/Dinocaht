// DinoChat Backend
// Node.js + Express + Socket.IO

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

// --------------------------------------------------
// Middleware
// --------------------------------------------------

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE"]
}));

app.use(express.json());

// --------------------------------------------------
// Socket.IO
// --------------------------------------------------

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// --------------------------------------------------
// Simple persistent JSON database
// --------------------------------------------------

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "database.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify({
      users: [],
      messages: []
    }, null, 2)
  );
}

function loadDatabase() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (error) {
    console.error("Database read error:", error);

    return {
      users: [],
      messages: []
    };
  }
}

let db = loadDatabase();

function saveDatabase() {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(db, null, 2)
  );
}

// --------------------------------------------------
// Helpers
// --------------------------------------------------

function generateDinoID() {
  let id;

  do {
    const random = crypto
      .randomBytes(4)
      .toString("hex")
      .toUpperCase();

    id = `DINO-${random}`;
  } while (db.users.some(user => user.dinoId === id));

  return id;
}

function generateMessageID() {
  return crypto.randomUUID();
}

function generateUserToken() {
  return crypto.randomBytes(32).toString("hex");
}

function findUserByToken(token) {
  return db.users.find(user => user.token === token);
}

// --------------------------------------------------
// Health check
// --------------------------------------------------

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    service: "DinoChat API",
    status: "online",
    time: new Date().toISOString()
  });
});

// --------------------------------------------------
// Register
// --------------------------------------------------

app.post("/api/auth/register", (req, res) => {
  const username = String(req.body.username || "").trim();

  if (!username) {
    return res.status(400).json({
      success: false,
      error: "Username is required."
    });
  }

  if (username.length < 2 || username.length > 24) {
    return res.status(400).json({
      success: false,
      error: "Username must be between 2 and 24 characters."
    });
  }

  const usernameExists = db.users.some(
    user => user.username.toLowerCase() === username.toLowerCase()
  );

  if (usernameExists) {
    return res.status(409).json({
      success: false,
      error: "Username is already taken."
    });
  }

  const dinoId = generateDinoID();
  const token = generateUserToken();

  const user = {
    id: crypto.randomUUID(),
    username,
    dinoId,
    token,
    coins: 0,
    score: 0,
    createdAt: new Date().toISOString()
  };

  db.users.push(user);

  saveDatabase();

  res.status(201).json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      dinoId: user.dinoId,
      coins: user.coins,
      score: user.score
    },
    token
  });
});

// --------------------------------------------------
// Login using permanent Dino ID
// --------------------------------------------------

app.post("/api/auth/login", (req, res) => {
  const dinoId = String(req.body.dinoId || "")
    .trim()
    .toUpperCase();

  if (!dinoId) {
    return res.status(400).json({
      success: false,
      error: "Dino ID is required."
    });
  }

  const user = db.users.find(
    user => user.dinoId === dinoId
  );

  if (!user) {
    return res.status(404).json({
      success: false,
      error: "Dino ID not found."
    });
  }

  // Create a fresh session token.
  user.token = generateUserToken();

  saveDatabase();

  res.json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      dinoId: user.dinoId,
      coins: user.coins,
      score: user.score
    },
    token: user.token
  });
});

// --------------------------------------------------
// Get current account
// --------------------------------------------------

app.get("/api/account", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");

  const user = findUserByToken(token);

  if (!user) {
    return res.status(401).json({
      success: false,
      error: "Invalid session."
    });
  }

  res.json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      dinoId: user.dinoId,
      coins: user.coins,
      score: user.score,
      createdAt: user.createdAt
    }
  });
});

// --------------------------------------------------
// Change username
// --------------------------------------------------

app.put("/api/account/username", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");

  const user = findUserByToken(token);

  if (!user) {
    return res.status(401).json({
      success: false,
      error: "Invalid session."
    });
  }

  const username = String(req.body.username || "").trim();

  if (username.length < 2 || username.length > 24) {
    return res.status(400).json({
      success: false,
      error: "Username must be between 2 and 24 characters."
    });
  }

  const usernameExists = db.users.some(
    other =>
      other.id !== user.id &&
      other.username.toLowerCase() === username.toLowerCase()
  );

  if (usernameExists) {
    return res.status(409).json({
      success: false,
      error: "Username is already taken."
    });
  }

  user.username = username;

  saveDatabase();

  // Tell connected clients about the updated user.
  io.emit("user-updated", {
    userId: user.id,
    username: user.username
  });

  res.json({
    success: true,
    username: user.username
  });
});

// --------------------------------------------------
// Get Dinosaur global chat history
// --------------------------------------------------

app.get("/api/messages", (req, res) => {
  const limit = Math.min(
    Number(req.query.limit) || 100,
    500
  );

  const messages = db.messages.slice(-limit);

  res.json({
    success: true,
    messages
  });
});

// --------------------------------------------------
// Send message through REST API
// --------------------------------------------------

app.post("/api/messages", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");

  const user = findUserByToken(token);

  if (!user) {
    return res.status(401).json({
      success: false,
      error: "Invalid session."
    });
  }

  const text = String(req.body.text || "").trim();

  if (!text) {
    return res.status(400).json({
      success: false,
      error: "Message cannot be empty."
    });
  }

  if (text.length > 2000) {
    return res.status(400).json({
      success: false,
      error: "Message is too long."
    });
  }

  const message = {
    id: generateMessageID(),
    userId: user.id,
    username: user.username,
    dinoId: user.dinoId,
    text,
    createdAt: new Date().toISOString()
  };

  db.messages.push(message);

  // Keep database from growing forever during prototype stage.
  if (db.messages.length > 5000) {
    db.messages = db.messages.slice(-5000);
  }

  // Reward activity.
  user.coins += 1;
  user.score += 1;

  saveDatabase();

  // Send to EVERY connected DinoChat user.
  io.emit("new-message", message);

  res.status(201).json({
    success: true,
    message
  });
});

// --------------------------------------------------
// Delete message
// --------------------------------------------------

app.delete("/api/messages/:id", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");

  const user = findUserByToken(token);

  if (!user) {
    return res.status(401).json({
      success: false,
      error: "Invalid session."
    });
  }

  const messageIndex = db.messages.findIndex(
    message => message.id === req.params.id
  );

  if (messageIndex === -1) {
    return res.status(404).json({
      success: false,
      error: "Message not found."
    });
  }

  const message = db.messages[messageIndex];

  if (message.userId !== user.id) {
    return res.status(403).json({
      success: false,
      error: "You can only delete your own messages."
    });
  }

  db.messages.splice(messageIndex, 1);

  saveDatabase();

  io.emit("message-deleted", {
    id: message.id
  });

  res.json({
    success: true
  });
});

// --------------------------------------------------
// Dino Scores
// --------------------------------------------------

app.get("/api/scores", (req, res) => {
  const scores = [...db.users]
    .sort((a, b) => b.score - a.score)
    .slice(0, 100)
    .map((user, index) => ({
      rank: index + 1,
      username: user.username,
      dinoId: user.dinoId,
      score: user.score,
      coins: user.coins
    }));

  res.json({
    success: true,
    scores
  });
});

// --------------------------------------------------
// Socket.IO connections
// --------------------------------------------------

io.on("connection", socket => {

  console.log("Dino connected:", socket.id);

  // User joins global Dinosaur room.
  socket.on("join-dinosaur", data => {

    const token = data?.token;

    const user = findUserByToken(token);

    if (!user) {
      socket.emit("auth-error", {
        error: "Invalid session."
      });

      return;
    }

    socket.userId = user.id;
    socket.dinoId = user.dinoId;

    socket.join("dinosaur");

    socket.emit("joined-dinosaur", {
      success: true,
      username: user.username,
      dinoId: user.dinoId
    });

    socket.to("dinosaur").emit("user-online", {
      username: user.username,
      dinoId: user.dinoId
    });

    console.log(
      `${user.username} joined Dinosaur`
    );
  });

  // Real-time message.
  socket.on("send-message", data => {

    if (!socket.userId) {
      socket.emit("auth-error", {
        error: "You must join Dinosaur first."
      });

      return;
    }

    const user = db.users.find(
      user => user.id === socket.userId
    );

    if (!user) return;

    const text = String(data?.text || "").trim();

    if (!text || text.length > 2000) {
      return;
    }

    const message = {
      id: generateMessageID(),
      userId: user.id,
      username: user.username,
      dinoId: user.dinoId,
      text,
      createdAt: new Date().toISOString()
    };

    db.messages.push(message);

    if (db.messages.length > 5000) {
      db.messages = db.messages.slice(-5000);
    }

    user.coins += 1;
    user.score += 1;

    saveDatabase();

    io.to("dinosaur").emit(
      "new-message",
      message
    );
  });

  // Delete message in real time.
  socket.on("delete-message", messageId => {

    if (!socket.userId) return;

    const index = db.messages.findIndex(
      message => message.id === messageId
    );

    if (index === -1) return;

    const message = db.messages[index];

    if (message.userId !== socket.userId) {
      return;
    }

    db.messages.splice(index, 1);

    saveDatabase();

    io.to("dinosaur").emit(
      "message-deleted",
      {
        id: messageId
      }
    );
  });

  // Disconnect.
  socket.on("disconnect", () => {

    console.log(
      "Dino disconnected:",
      socket.id
    );
  });
});

// --------------------------------------------------
// Start server
// --------------------------------------------------

server.listen(PORT, () => {

  console.log("");
  console.log("🦖 DinoChat Server");
  console.log("-------------------------");
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 API: http://localhost:${PORT}/api`);
  console.log(`💬 Socket.IO: http://localhost:${PORT}`);
  console.log("");
});
