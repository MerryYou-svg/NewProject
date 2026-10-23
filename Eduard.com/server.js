const express = require('express');
const cors = require('cors');
const pool = require('./db.js');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

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

// API 3: User Register
app.post('/api/register', async (req, res) => {
  const { full_name, email, password, role, delivery_address } = req.body;
  try {
    const userExist = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userExist.rows.length > 0) {
      return res.json({ success: false, message: 'Email already registered!' });
    }

    const newUser = await pool.query(
      'INSERT INTO users (full_name, email, password, role, delivery_address) VALUES ($1, $2, $3, $4, $5) RETURNING id, full_name, email, role, delivery_address',
      [full_name, email, password, role, delivery_address || '']
    );

    res.json({ success: true, user: newUser.rows[0] });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
