// Load values such as MONGODB_URI and PORT from the .env file.
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

// Create the Express application and choose the port to listen on.
const app = express();
const PORT = process.env.PORT || 5000;

// Parse JSON request bodies so routes can read values from req.body.
app.use(express.json());

// Show the users webpage when someone visits the server's home address.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// A schema describes which fields each user document must contain.
// MongoDB adds createdAt and updatedAt automatically because timestamps is enabled.
// The unique option prevents MongoDB from storing duplicate email values.
const userSchema = new mongoose.Schema({
  userId: {
    type: Number,
    required: true,
    min: 10000,
    max: 99999,
    validate: Number.isInteger,
    unique: true,
    sparse: true
  },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true }
}, {
  timestamps: true,
  toJSON: {
    transform: (document, result) => {
      result.id = result.userId;
      delete result.userId;
      delete result._id;
      delete result.__v;
      return result;
    }
  }
});

// The User model lets routes create, find, update, and delete user documents.
const User = mongoose.model('User', userSchema);

// This counter safely assigns a different sequential ID to each new user.
const counterSchema = new mongoose.Schema({
  _id: String,
  sequence: { type: Number, required: true }
});
const Counter = mongoose.model('Counter', counterSchema);

let databaseReady = false;

async function nextUserId() {
  const counter = await Counter.findOneAndUpdate(
    { _id: 'users' },
    { $inc: { sequence: 1 } },
    { new: true }
  );

  if (!counter || counter.sequence > 99999) {
    const error = new Error('All five-digit user IDs have been used.');
    error.code = 'USER_IDS_EXHAUSTED';
    throw error;
  }

  return counter.sequence;
}

async function initializeUserIds() {
  await User.init(); // Create the unique indexes before assigning public IDs.

  const highestAssignedUser = await User.findOne({ userId: { $exists: true } })
    .sort({ userId: -1 })
    .select('userId')
    .lean();
  const startingSequence = Math.max(9999, highestAssignedUser?.userId || 9999);

  // Keep the counter at least as high as IDs already stored in the database.
  await Counter.updateOne(
    { _id: 'users' },
    { $max: { sequence: startingSequence } },
    { upsert: true }
  );

  // Give existing users an ID too, so every API response uses the same format.
  const usersWithoutId = await User.find({ userId: { $exists: false } })
    .select('_id')
    .lean();
  for (const user of usersWithoutId) {
    const userId = await nextUserId();
    await User.updateOne(
      { _id: user._id, userId: { $exists: false } },
      { $set: { userId } }
    );
  }
}

// Keep API requests unavailable until MongoDB and the user ID counter are ready.
app.use('/api', (req, res, next) => {
  if (!databaseReady) {
    return res.status(503).json({ error: 'The database is not ready yet.' });
  }
  next();
});

// Connect to MongoDB, prepare five-digit IDs, then allow API requests.
mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    await initializeUserIds();
    databaseReady = true;
    console.log('Connected to MongoDB Atlas successfully!');
  })
  .catch((err) => console.error('MongoDB initialization error:', err));

// POST /api/users: create a user from the JSON body sent by the client.
app.post('/api/users', async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!name || !email) {
      // 400 means the client did not provide all required fields.
      return res.status(400).json({ error: 'Name and email are required.' });
    }

    const userId = await nextUserId();
    const newUser = new User({ userId, name, email });
    await newUser.save(); // Save the new document to MongoDB.
    res.status(201).json(newUser); // 201 means a resource was created.
  } catch (error) {
    if (error.code === 'USER_IDS_EXHAUSTED') {
      return res.status(503).json({ error: error.message });
    }
    if (error.code === 11000) {
      return res.status(409).json({ error: 'A user with this email already exists.' });
    }
    // Send an error response if validation or the database operation fails.
    res.status(500).json({ error: error.message });
  }
});

// GET /api/users: return every user as a JSON array.
app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find();
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/users/:id: find and return one user using its five-digit ID.
app.get('/api/users/:id', async (req, res) => {
  if (!/^\d{5}$/.test(req.params.id)) {
    return res.status(400).json({ error: 'User ID must be exactly five digits.' });
  }

  try {
    const user = await User.findOne({ userId: Number(req.params.id) });
    if (!user) {
      // 404 means the requested ID does not match a saved user.
      return res.status(404).json({ error: 'User not found.' });
    }
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/users/:id: update a user's name and email from the JSON body.
app.put('/api/users/:id', async (req, res) => {
  if (!/^\d{5}$/.test(req.params.id)) {
    return res.status(400).json({ error: 'User ID must be exactly five digits.' });
  }

  try {
    const { name, email } = req.body;
    const updatedUser = await User.findOneAndUpdate(
      { userId: Number(req.params.id) },
      { name, email },
      { new: true, runValidators: true } // Return the updated user and check schema rules.
    );

    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.status(200).json(updatedUser);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: 'A user with this email already exists.' });
    }
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/users/:id: remove a user using its five-digit ID.
app.delete('/api/users/:id', async (req, res) => {
  if (!/^\d{5}$/.test(req.params.id)) {
    return res.status(400).json({ error: 'User ID must be exactly five digits.' });
  }

  try {
    const deletedUser = await User.findOneAndDelete({ userId: Number(req.params.id) });
    if (!deletedUser) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.status(200).json({ message: 'User deleted successfully.', user: deletedUser });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start accepting HTTP requests after all routes have been registered.
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});