const express = require('express');
const cors = require('cors');
const pool = require('./db.js');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// --------------------------------------------------------
// AUTO-CREATE AT RESET TABLES SA POSTGRESQL (Render DB Setup)
// --------------------------------------------------------
const initDB = async () => {
  try {
    // 1. Create Users Table
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
    
    // 2. Create Products Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        price NUMERIC(10, 2) NOT NULL,
        stock INT NOT NULL DEFAULT 0,
        sold_units INT DEFAULT 0
      );
    `);
    
    // 3. Create Orders Table
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

// Patakbuhin ang Table Creation sa pag-start ng server
initDB();

// --------------------------------------------------------
// SPECIAL ROUTE: CLEAR ALL USERS / RESET ACCOUNTS
// --------------------------------------------------------
app.get('/api/clear-users', async (req, res) => {
  try {
    await pool.query('TRUNCATE TABLE users RESTART IDENTITY CASCADE;');
    res.json({ success: true, message: 'All user accounts have been successfully deleted/cleared!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Root route para walang "Cannot GET /" error
app.get('/', (req, res) => {
  res.send('EDS Backend API is Running Online!');
});

// --------------------------------------------------------
// API ENDPOINTS
// --------------------------------------------------------

// API 1: Get All Products
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API 2: Add Product (Owner)
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

// API 3: User Register (Worker 1 / Worker 2 Limit)
app.post('/api/register', async (req, res) => {
  const { full_name, email, password, role, delivery_address } = req.body;
  try {
    const userExist = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userExist.rows.length > 0) {
      return res.json({ success: false, message: 'Email already registered!' });
    }
    
    let assignedRole = role;
    
    if (role === 'Worker' || role.startsWith('Worker')) {
      const existingWorkers = await pool.query("SELECT * FROM users WHERE role LIKE 'Worker%' ORDER BY id ASC");
      
      if (existingWorkers.rows.length >= 2) {
        return res.json({ success: false, message: 'Registration closed: Maximum of 2 Worker accounts reached!' });
      } else if (existingWorkers.rows.length === 0) {
        assignedRole = 'Worker 1';
      } else if (existingWorkers.rows.length === 1) {
        const firstRole = existingWorkers.rows[0].role;
        assignedRole = (firstRole === 'Worker 1') ? 'Worker 2' : 'Worker 1';
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

// API 4: User Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1 AND password = $2', [email, password]);
    if (result.rows.length === 0) {
      return res.json({ success: false, message: 'Invalid credentials!' });
    }
    const user = result.rows[0];
    delete user.password;
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// API 5: Get All Orders
app.get('/api/orders', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API 6: Place New Order / Manual Sale
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
          [item.quantity, item.product_id]
        );
      }
    }
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// API 7: Update Order Status
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

// API 8: Delete Order History for Client
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
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});