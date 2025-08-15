import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

type Bindings = {
  DB: D1Database;
}

const app = new Hono<{ Bindings: Bindings }>()

// Enable CORS for API routes
app.use('/api/*', cors())

// Serve static files
app.use('/static/*', serveStatic({ root: './public' }))
app.use('/favicon.ico', serveStatic({ root: './public' }))

// API Routes

// Get all categories
app.get('/api/categories', async (c) => {
  const { DB } = c.env;
  const categories = await DB.prepare('SELECT * FROM categories ORDER BY name').all();
  return c.json(categories.results);
});

// Get all brands
app.get('/api/brands', async (c) => {
  const { DB } = c.env;
  const brands = await DB.prepare('SELECT * FROM brands ORDER BY name').all();
  return c.json(brands.results);
});

// Get products with filters
app.get('/api/products', async (c) => {
  const { DB } = c.env;
  const { 
    category, 
    brand, 
    minPrice, 
    maxPrice, 
    sort = 'featured',
    search,
    page = '1',
    limit = '12'
  } = c.req.query();

  let query = `
    SELECT 
      p.*,
      c.name as category_name,
      b.name as brand_name
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE p.is_active = 1
  `;
  
  const params = [];

  if (category) {
    query += ' AND c.slug = ?';
    params.push(category);
  }

  if (brand) {
    query += ' AND b.slug = ?';
    params.push(brand);
  }

  if (minPrice) {
    query += ' AND p.price >= ?';
    params.push(Number(minPrice));
  }

  if (maxPrice) {
    query += ' AND p.price <= ?';
    params.push(Number(maxPrice));
  }

  if (search) {
    query += ' AND (p.name LIKE ? OR p.description LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  // Sorting
  switch (sort) {
    case 'price-low':
      query += ' ORDER BY p.price ASC';
      break;
    case 'price-high':
      query += ' ORDER BY p.price DESC';
      break;
    case 'rating':
      query += ' ORDER BY p.rating DESC';
      break;
    case 'newest':
      query += ' ORDER BY p.created_at DESC';
      break;
    default:
      query += ' ORDER BY p.is_featured DESC, p.rating DESC';
  }

  // Pagination
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;
  
  query += ' LIMIT ? OFFSET ?';
  params.push(limitNum, offset);

  const products = await DB.prepare(query).bind(...params).all();

  // Get total count for pagination
  let countQuery = `
    SELECT COUNT(*) as total
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE p.is_active = 1
  `;
  
  const countParams = [];
  
  if (category) {
    countQuery += ' AND c.slug = ?';
    countParams.push(category);
  }

  if (brand) {
    countQuery += ' AND b.slug = ?';
    countParams.push(brand);
  }

  if (minPrice) {
    countQuery += ' AND p.price >= ?';
    countParams.push(Number(minPrice));
  }

  if (maxPrice) {
    countQuery += ' AND p.price <= ?';
    countParams.push(Number(maxPrice));
  }

  if (search) {
    countQuery += ' AND (p.name LIKE ? OR p.description LIKE ?)';
    countParams.push(`%${search}%`, `%${search}%`);
  }

  const countResult = await DB.prepare(countQuery).bind(...countParams).first();
  const total = countResult?.total || 0;

  return c.json({
    products: products.results.map(p => ({
      ...p,
      images: p.images ? JSON.parse(p.images) : [],
      specifications: p.specifications ? JSON.parse(p.specifications) : {},
      features: p.features ? JSON.parse(p.features) : []
    })),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum)
    }
  });
});

// Get single product
app.get('/api/products/:slug', async (c) => {
  const { DB } = c.env;
  const slug = c.req.param('slug');
  
  const product = await DB.prepare(`
    SELECT 
      p.*,
      c.name as category_name,
      b.name as brand_name
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE p.slug = ? AND p.is_active = 1
  `).bind(slug).first();

  if (!product) {
    return c.json({ error: 'Product not found' }, 404);
  }

  return c.json({
    ...product,
    images: product.images ? JSON.parse(product.images) : [],
    specifications: product.specifications ? JSON.parse(product.specifications) : {},
    features: product.features ? JSON.parse(product.features) : []
  });
});

// Cart APIs
app.get('/api/cart/:sessionId', async (c) => {
  const { DB } = c.env;
  const sessionId = c.req.param('sessionId');
  
  const items = await DB.prepare(`
    SELECT 
      ci.*,
      p.name,
      p.slug,
      p.price,
      p.image_url,
      p.stock
    FROM cart_items ci
    JOIN products p ON ci.product_id = p.id
    WHERE ci.session_id = ?
    ORDER BY ci.created_at DESC
  `).bind(sessionId).all();

  const total = items.results.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  return c.json({
    items: items.results,
    total,
    count: items.results.length
  });
});

app.post('/api/cart/:sessionId/add', async (c) => {
  const { DB } = c.env;
  const sessionId = c.req.param('sessionId');
  const { productId, quantity = 1 } = await c.req.json();

  // Check if product exists and has stock
  const product = await DB.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').bind(productId).first();
  
  if (!product) {
    return c.json({ error: 'Product not found' }, 404);
  }

  if (product.stock < quantity) {
    return c.json({ error: 'Insufficient stock' }, 400);
  }

  // Add or update cart item
  await DB.prepare(`
    INSERT INTO cart_items (session_id, product_id, quantity, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(session_id, product_id) DO UPDATE SET
      quantity = quantity + ?,
      updated_at = CURRENT_TIMESTAMP
  `).bind(sessionId, productId, quantity, quantity).run();

  return c.json({ success: true });
});

app.put('/api/cart/:sessionId/update', async (c) => {
  const { DB } = c.env;
  const sessionId = c.req.param('sessionId');
  const { productId, quantity } = await c.req.json();

  if (quantity <= 0) {
    // Remove item if quantity is 0 or less
    await DB.prepare('DELETE FROM cart_items WHERE session_id = ? AND product_id = ?')
      .bind(sessionId, productId).run();
  } else {
    // Update quantity
    await DB.prepare(`
      UPDATE cart_items 
      SET quantity = ?, updated_at = CURRENT_TIMESTAMP
      WHERE session_id = ? AND product_id = ?
    `).bind(quantity, sessionId, productId).run();
  }

  return c.json({ success: true });
});

app.delete('/api/cart/:sessionId/item/:productId', async (c) => {
  const { DB } = c.env;
  const sessionId = c.req.param('sessionId');
  const productId = c.req.param('productId');

  await DB.prepare('DELETE FROM cart_items WHERE session_id = ? AND product_id = ?')
    .bind(sessionId, productId).run();

  return c.json({ success: true });
});

app.delete('/api/cart/:sessionId', async (c) => {
  const { DB } = c.env;
  const sessionId = c.req.param('sessionId');

  await DB.prepare('DELETE FROM cart_items WHERE session_id = ?').bind(sessionId).run();

  return c.json({ success: true });
});

// Order API
app.post('/api/orders', async (c) => {
  const { DB } = c.env;
  const {
    sessionId,
    customerName,
    customerEmail,
    customerPhone,
    shippingAddress,
    billingAddress,
    paymentMethod
  } = await c.req.json();

  // Get cart items
  const cartItems = await DB.prepare(`
    SELECT ci.*, p.name, p.price
    FROM cart_items ci
    JOIN products p ON ci.product_id = p.id
    WHERE ci.session_id = ?
  `).bind(sessionId).all();

  if (cartItems.results.length === 0) {
    return c.json({ error: 'Cart is empty' }, 400);
  }

  // Calculate totals
  const subtotal = cartItems.results.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const tax = subtotal * 0.1; // 10% tax
  const shippingFee = subtotal > 10000 ? 0 : 800; // Free shipping over 10,000
  const total = subtotal + tax + shippingFee;

  // Generate order number
  const orderNumber = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

  // Create order
  const orderResult = await DB.prepare(`
    INSERT INTO orders (
      order_number, session_id, customer_name, customer_email,
      customer_phone, shipping_address, billing_address,
      subtotal, tax, shipping_fee, total,
      payment_method, status, payment_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    orderNumber, sessionId, customerName, customerEmail,
    customerPhone, shippingAddress, billingAddress || shippingAddress,
    subtotal, tax, shippingFee, total,
    paymentMethod, 'pending', 'pending'
  ).run();

  const orderId = orderResult.meta.last_row_id;

  // Create order items
  for (const item of cartItems.results) {
    await DB.prepare(`
      INSERT INTO order_items (
        order_id, product_id, product_name, product_price,
        quantity, subtotal
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      orderId, item.product_id, item.name, item.price,
      item.quantity, item.price * item.quantity
    ).run();

    // Update product stock
    await DB.prepare(`
      UPDATE products 
      SET stock = stock - ?
      WHERE id = ?
    `).bind(item.quantity, item.product_id).run();
  }

  // Clear cart
  await DB.prepare('DELETE FROM cart_items WHERE session_id = ?').bind(sessionId).run();

  return c.json({
    orderId,
    orderNumber,
    total
  });
});

// Main page
app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>ラップトップストア - 最高のノートパソコンをお届け</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-50">
        <!-- Header -->
        <header class="bg-white shadow-sm sticky top-0 z-40">
            <div class="container mx-auto px-4">
                <div class="flex items-center justify-between h-16">
                    <div class="flex items-center">
                        <i class="fas fa-laptop text-blue-600 text-2xl mr-2"></i>
                        <h1 class="text-xl font-bold text-gray-800">ラップトップストア</h1>
                    </div>
                    <div class="flex items-center space-x-4">
                        <div class="relative">
                            <input type="text" id="searchInput" placeholder="商品を検索..." 
                                class="w-64 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                            <button onclick="searchProducts()" class="absolute right-2 top-2 text-gray-500 hover:text-blue-600">
                                <i class="fas fa-search"></i>
                            </button>
                        </div>
                        <button onclick="toggleCart()" class="relative p-2 text-gray-600 hover:text-blue-600">
                            <i class="fas fa-shopping-cart text-xl"></i>
                            <span id="cartCount" class="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">0</span>
                        </button>
                    </div>
                </div>
            </div>
        </header>

        <div class="container mx-auto px-4 py-8">
            <div class="flex gap-8">
                <!-- Filters Sidebar -->
                <aside class="w-64 bg-white rounded-lg shadow p-6">
                    <h2 class="text-lg font-semibold mb-4">フィルター</h2>
                    
                    <!-- Category Filter -->
                    <div class="mb-6">
                        <h3 class="font-medium mb-2">カテゴリー</h3>
                        <div id="categoryFilter" class="space-y-2"></div>
                    </div>

                    <!-- Brand Filter -->
                    <div class="mb-6">
                        <h3 class="font-medium mb-2">ブランド</h3>
                        <div id="brandFilter" class="space-y-2"></div>
                    </div>

                    <!-- Price Filter -->
                    <div class="mb-6">
                        <h3 class="font-medium mb-2">価格帯</h3>
                        <div class="space-y-2">
                            <input type="number" id="minPrice" placeholder="最低価格" 
                                class="w-full px-3 py-2 border rounded">
                            <input type="number" id="maxPrice" placeholder="最高価格" 
                                class="w-full px-3 py-2 border rounded">
                        </div>
                    </div>

                    <button onclick="applyFilters()" 
                        class="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700">
                        フィルター適用
                    </button>
                    <button onclick="clearFilters()" 
                        class="w-full mt-2 bg-gray-200 text-gray-700 py-2 rounded-lg hover:bg-gray-300">
                        クリア
                    </button>
                </aside>

                <!-- Main Content -->
                <main class="flex-1">
                    <!-- Sort Options -->
                    <div class="bg-white rounded-lg shadow p-4 mb-6">
                        <div class="flex items-center justify-between">
                            <span id="productCount" class="text-gray-600"></span>
                            <select id="sortSelect" onchange="applyFilters()" 
                                class="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                                <option value="featured">おすすめ順</option>
                                <option value="price-low">価格が安い順</option>
                                <option value="price-high">価格が高い順</option>
                                <option value="rating">評価が高い順</option>
                                <option value="newest">新着順</option>
                            </select>
                        </div>
                    </div>

                    <!-- Products Grid -->
                    <div id="productsGrid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        <!-- Products will be loaded here -->
                    </div>

                    <!-- Pagination -->
                    <div id="pagination" class="mt-8 flex justify-center"></div>
                </main>
            </div>
        </div>

        <!-- Cart Sidebar -->
        <div id="cartSidebar" class="fixed right-0 top-0 h-full w-96 bg-white shadow-xl transform translate-x-full transition-transform z-50">
            <div class="p-6 border-b">
                <div class="flex items-center justify-between">
                    <h2 class="text-xl font-semibold">ショッピングカート</h2>
                    <button onclick="toggleCart()" class="text-gray-500 hover:text-gray-700">
                        <i class="fas fa-times text-xl"></i>
                    </button>
                </div>
            </div>
            <div id="cartItems" class="p-6 overflow-y-auto" style="max-height: calc(100vh - 200px);">
                <!-- Cart items will be loaded here -->
            </div>
            <div class="absolute bottom-0 left-0 right-0 p-6 border-t bg-white">
                <div class="flex justify-between mb-4">
                    <span class="font-semibold">合計:</span>
                    <span id="cartTotal" class="text-xl font-bold">¥0</span>
                </div>
                <button onclick="checkout()" class="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700">
                    レジに進む
                </button>
            </div>
        </div>

        <!-- Product Modal -->
        <div id="productModal" class="fixed inset-0 bg-black bg-opacity-50 hidden z-50">
            <div class="flex items-center justify-center min-h-screen p-4">
                <div class="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
                    <div id="modalContent"></div>
                </div>
            </div>
        </div>

        <script src="/static/app.js"></script>
    </body>
    </html>
  `);
});

export default app