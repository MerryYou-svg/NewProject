const express = require('express');
const cors = require('cors');
const pool = require('./db.js');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Database Tables
const initDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
        delivery_address TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        price NUMERIC(10, 2) NOT NULL,
        stock INT NOT NULL DEFAULT 0,
        sold_units INT DEFAULT 0
      );
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id VARCHAR(100) PRIMARY KEY,
        client_name VARCHAR(255),
        client_address TEXT,
        total_amount NUMERIC(10, 2) NOT NULL,
        payment_method VARCHAR(50),
        assigned_worker VARCHAR(255),
        status VARCHAR(50) DEFAULT 'Pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    console.log("Database tables initialized successfully!");
  } catch (err) {
    console.error("Error creating database tables:", err.message);
  }
};

initDB();

// API: Clear Users (Reset Testing Accounts)
app.get('/api/clear-users', async (req, res) => {
  try {
    await pool.query('TRUNCATE TABLE users RESTART IDENTITY CASCADE;');
    res.json({ success: true, message: 'All user accounts have been successfully deleted/cleared!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// API: Check Available Roles & Worker Slots
app.get('/api/role-status', async (req, res) => {
  try {
    const existingUsers = await pool.query("SELECT role FROM users");
    const roles = existingUsers.rows.map(u => u.role);
    res.json({
      worker1Taken: roles.includes('Worker 1'),
      worker2Taken: roles.includes('Worker 2'),
      ownerTaken: roles.includes('Owner')
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Root Route
app.get('/', (req, res) => {
  res.send('EDS Backend API is Running Online!');
});

// API: Get Products
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Add Product (Owner)
app.post('/api/products', async (req, res) => {
  const { name, price, stock } = req.body;
  try {
    await pool.query(
      'INSERT INTO products (name, price, stock, sold_units) VALUES ($1, $2, $3, 0)',
      [name, price, stock]
    );
    res.json({ success: true, message: 'Product added successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// API: Update / Restock Product (Owner)
app.put('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  const { price, add_stock } = req.body;
  try {
    await pool.query(
      'UPDATE products SET price = $1, stock = stock + $2 WHERE id = $3',
      [price, add_stock, id]
    );
    res.json({ success: true, message: 'Product stock & price updated!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// API: Register User (Strict Checks for Worker 1, Worker 2, and Owner)
app.post('/api/register', async (req, res) => {
  const { full_name, email, password, role, worker_choice, delivery_address } = req.body;
  try {
    const userExist = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userExist.rows.length > 0) {
      return res.json({ success: false, message: 'Email address already registered!' });
    }
    
    let assignedRole = role;
    
    if (role === 'Worker' || role.startsWith('Worker')) {
      const selectedWorker = worker_choice || 'Worker 1';
      const workerExist = await pool.query('SELECT * FROM users WHERE role = $1', [selectedWorker]);
      if (workerExist.rows.length > 0) {
        return res.json({ success: false, message: `Account creation failed: ${selectedWorker} is already taken!` });
      }
      assignedRole = selectedWorker;
    } else if (role === 'Owner') {
      const ownerExist = await pool.query("SELECT * FROM users WHERE role = 'Owner'");
      if (ownerExist.rows.length > 0) {
        return res.json({ success: false, message: 'Account creation failed: Owner account already exists!' });
      }
    }
    
    const newUser = await pool.query(
      'INSERT INTO users (full_name, email, password, role, delivery_address) VALUES ($1, $2, $3, $4, $5) RETURNING id, full_name, email, role, delivery_address',
      [full_name, email, password, assignedRole, delivery_address || '']
    );
    
    res.json({ success: true, user: newUser.rows[0], message: `Registered successfully as ${assignedRole}!` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// API: Login User
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1 AND password = $2', [email, password]);
    if (result.rows.length === 0) {
      return res.json({ success: false, message: 'Invalid email or password!' });
    }
    const user = result.rows[0];
    delete user.password;
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// API: Get Orders
app.get('/api/orders', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Create Order
app.post('/api/orders', async (req, res) => {
  const { id, client_name, client_address, total_amount, payment_method, assigned_worker, status, items } = req.body;
  try {
    await pool.query(
      'INSERT INTO orders (id, client_name, client_address, total_amount, payment_method, assigned_worker, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())',
      [id, client_name, client_address, total_amount, payment_method, assigned_worker, status]
    );
    
    if (items && Array.isArray(items)) {
      for (let item of items) {
        await pool.query(
          'UPDATE products SET stock = stock - $1, sold_units = COALESCE(sold_units, 0) + $1 WHERE id = $2',
          [item.quantity || item.qty, item.product_id || item.id]
        );
      }
    }
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// API: Update Order Status
app.put('/api/orders/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// API: Delete History
app.delete('/api/orders/history/:orderId', async (req, res) => {
  const { orderId } = req.params;
  try {
    await pool.query("DELETE FROM orders WHERE id = $1 AND status IN ('Delivered', 'Cancelled')", [orderId]);
    res.json({ success: true, message: 'Order history item deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));