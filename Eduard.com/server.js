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

// Automatic table creation & verification uban ang image_url
pool.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    worker_choice VARCHAR(50),
    delivery_address TEXT
  );

  CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    bundle_price DECIMAL(10,2),
    bundle_qty INT DEFAULT 12,
    stock INT NOT NULL,
    sold_units INT DEFAULT 0,
    image_url TEXT
  );

  CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(50) PRIMARY KEY,
    client_name VARCHAR(255) NOT NULL,
    client_address TEXT,
    total_amount DECIMAL(10,2) NOT NULL,
    payment_method VARCHAR(50),
    assigned_worker VARCHAR(50),
    status VARCHAR(50) DEFAULT 'Pending',
    items JSONB,
    created_at TIMESTAMP DEFAULT NOW()
  );
`).then(async () => {
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS worker_choice VARCHAR(50);');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS delivery_address TEXT;');
  await pool.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS bundle_price DECIMAL(10,2);');
  await pool.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;');
  await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS items JSONB;');
  console.log('All database tables and columns verified successfully.');
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
      if (u.role === 'Worker 1' || u.worker_choice === 'Worker 1') worker1Taken = true;
      if (u.role === 'Worker 2' || u.worker_choice === 'Worker 2') worker2Taken = true;
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
    
    if (role === 'Owner') {
      const ownerCheck = await pool.query("SELECT * FROM users WHERE role = 'Owner'");
      if (ownerCheck.rows.length > 0) {
        return res.status(400).json({ success: false, message: 'Naa na nay Owner ang sistema!' });
      }
    }
    
    if (role === 'Worker') {
      finalRole = worker_choice || 'Worker 1';
      const workerCheck = await pool.query("SELECT * FROM users WHERE role = $1", [finalRole]);
      if (workerCheck.rows.length > 0) {
        return res.status(400).json({ success: false, message: `${finalRole} kay taken na!` });
      }
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

// Clear Database endpoints
app.get('/api/clear-users', async (req, res) => {
  try {
    await pool.query('DELETE FROM users');
    res.json({ success: true, message: 'All users cleared successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/clear-orders', async (req, res) => {
  try {
    await pool.query('DELETE FROM orders');
    res.json({ success: true, message: 'Tanang orders ug transaction history napatay na!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/clear-products', async (req, res) => {
  try {
    await pool.query('DELETE FROM products');
    res.json({ success: true, message: 'Tanang test products sa inventory napatay na!' });
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
  const { name, price, bundle_price, bundle_qty, stock, image_url } = req.body;
  try {
    const newProd = await pool.query(
      'INSERT INTO products (name, price, bundle_price, bundle_qty, stock, image_url) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [name, price, bundle_price, bundle_qty || 12, stock, image_url || null]
    );
    res.json({ success: true, product: newProd.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update Product / Restock
app.put('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  const { price, bundle_price, bundle_qty, add_stock, image_url } = req.body;
  try {
    await pool.query(
      'UPDATE products SET price = $1, bundle_price = $2, bundle_qty = $3, stock = stock + $4, image_url = COALESCE($5, image_url) WHERE id = $6',
      [price, bundle_price, bundle_qty || 12, add_stock || 0, image_url || null, id]
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

// Create Order
app.post('/api/orders', async (req, res) => {
  const { id, client_name, client_address, total_amount, payment_method, assigned_worker, status, items } = req.body;
  try {
    await pool.query(
      'INSERT INTO orders (id, client_name, client_address, total_amount, payment_method, assigned_worker, status, items, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())',
      [id, client_name, client_address, total_amount, payment_method, assigned_worker, status, JSON.stringify(items)]
    );
    
    if (status === 'Delivered' && items) {
      let parsedItems = items;
      if (typeof parsedItems === 'string') {
        try { parsedItems = JSON.parse(parsedItems); } catch (e) {}
      }
      if (Array.isArray(parsedItems)) {
        for (let item of parsedItems) {
          const qtyDeduct = item.quantity || item.qty || 1;
          await pool.query(
            'UPDATE products SET stock = stock - $1, sold_units = COALESCE(sold_units, 0) + $1 WHERE id = $2',
            [qtyDeduct, item.product_id || item.id]
          );
        }
      }
    }
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update Order Status
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