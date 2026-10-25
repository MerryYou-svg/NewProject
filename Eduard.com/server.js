const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// I-recreate ang products table aron masiguro nga naapil ang bundle_price column
pool.query(`
  DROP TABLE IF EXISTS products CASCADE;
  CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    bundle_price DECIMAL(10,2),
    bundle_qty INT DEFAULT 12,
    stock INT NOT NULL,
    sold_units INT DEFAULT 0
  );
`).then(() => {
  console.log('Products table re-created successfully with bundle_price!');
}).catch(err => console.log('DB Setup Error:', err.message));

// Role status check endpoint
app.get('/api/role-status', async (req, res) => {
  try {
    const usersRes = await pool.query('SELECT role, worker_choice FROM users');
    let ownerTaken = false;
    let worker1Taken = false;
    let worker2Taken = false;
    
    usersRes.rows.forEach(u => {
      if (u.role === 'Owner') ownerTaken = true;
      if (u.role === 'Worker' || u.worker_choice === 'Worker 1') {
        if (u.role === 'Worker 1' || u.worker_choice === 'Worker 1') worker1Taken = true;
        if (u.role === 'Worker 2' || u.worker_choice === 'Worker 2') worker2Taken = true;
      }
    });
    
    res.json({ ownerTaken, worker1Taken, worker2Taken });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Register endpoint
app.post('/api/register', async (req, res) => {
  const { full_name, email, password, role, worker_choice, delivery_address } = req.body;
  try {
    let finalRole = role;
    if (role === 'Worker') {
      finalRole = worker_choice || 'Worker 1';
    }
    
    const newUser = await pool.query(
      'INSERT INTO users (full_name, email, password, role, worker_choice, delivery_address) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [full_name, email, password, finalRole, worker_choice || null, delivery_address || null]
    );
    
    res.json({ success: true, message: 'Account registered successfully!', user: newUser.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const userRes = await pool.query('SELECT * FROM users WHERE email = $1 AND password = $2', [email, password]);
    if (userRes.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid email or password.' });
    }
    res.json({ success: true, user: userRes.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get Products
app.get('/api/products', async (req, res) => {
  try {
    const products = await pool.query('SELECT * FROM products ORDER BY id ASC');
    res.json(products.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add Product
app.post('/api/products', async (req, res) => {
  const { name, price, bundle_price, bundle_qty, stock } = req.body;
  try {
    const newProd = await pool.query(
      'INSERT INTO products (name, price, bundle_price, bundle_qty, stock) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, price, bundle_price, bundle_qty || 12, stock]
    );
    res.json({ success: true, product: newProd.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update Product / Restock
app.put('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  const { price, bundle_price, bundle_qty, add_stock } = req.body;
  try {
    await pool.query(
      'UPDATE products SET price = $1, bundle_price = $2, bundle_qty = $3, stock = stock + $4 WHERE id = $5',
      [price, bundle_price, bundle_qty || 12, add_stock || 0, id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get Orders
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
    res.json(orders.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create Order (Dili pa mo-minus ang stock dire, maghulat sa approval)
app.post('/api/orders', async (req, res) => {
  const { id, client_name, client_address, total_amount, payment_method, assigned_worker, status, items } = req.body;
  try {
    await pool.query(
      'INSERT INTO orders (id, client_name, client_address, total_amount, payment_method, assigned_worker, status, items, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())',
      [id, client_name, client_address, total_amount, payment_method, assigned_worker, status, JSON.stringify(items)]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update Order Status (Dinhi ra maminusan ang stock kung i-approve o i-deliver na sa worker)
app.put('/api/orders/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    const orderRes = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
    if (orderRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found!' });
    }
    
    const order = orderRes.rows[0];
    
    if (order.status === 'Pending' && (status === 'Approved' || status === 'Delivered')) {
      let items = order.items;
      if (typeof items === 'string') {
        try { items = JSON.parse(items); } catch (e) {}
      }
      
      if (items && Array.isArray(items)) {
        for (let item of items) {
          const qtyDeduct = item.quantity || item.qty || 12;
          await pool.query(
            'UPDATE products SET stock = stock - $1, sold_units = COALESCE(sold_units, 0) + $1 WHERE id = $2',
            [qtyDeduct, item.product_id || item.id]
          );
        }
      }
    }
    
    await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, id]);
    res.json({ success: true, message: `Order status updated to ${status} and stock deducted!` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Delete Order History
app.delete('/api/orders/history/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM orders WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});