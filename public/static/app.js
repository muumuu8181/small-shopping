// Global variables
let currentFilters = {
    category: null,
    brand: null,
    minPrice: null,
    maxPrice: null,
    search: null,
    sort: 'featured',
    page: 1
};

let cart = [];
const sessionId = getOrCreateSessionId();

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    loadFilters();
    loadProducts();
    loadCart();
});

// Session management
function getOrCreateSessionId() {
    let sessionId = localStorage.getItem('sessionId');
    if (!sessionId) {
        sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('sessionId', sessionId);
    }
    return sessionId;
}

// Load filters
async function loadFilters() {
    try {
        // Load categories
        const categoriesRes = await fetch('/api/categories');
        const categories = await categoriesRes.json();
        const categoryFilter = document.getElementById('categoryFilter');
        categoryFilter.innerHTML = categories.map(cat => `
            <label class="flex items-center">
                <input type="radio" name="category" value="${cat.slug}" 
                    class="mr-2" onchange="handleCategoryChange('${cat.slug}')">
                <span>${cat.name}</span>
            </label>
        `).join('');

        // Load brands
        const brandsRes = await fetch('/api/brands');
        const brands = await brandsRes.json();
        const brandFilter = document.getElementById('brandFilter');
        brandFilter.innerHTML = brands.map(brand => `
            <label class="flex items-center">
                <input type="checkbox" value="${brand.slug}" 
                    class="mr-2" onchange="handleBrandChange('${brand.slug}')">
                <span>${brand.name}</span>
            </label>
        `).join('');
    } catch (error) {
        console.error('Error loading filters:', error);
    }
}

// Handle filter changes
function handleCategoryChange(category) {
    currentFilters.category = category;
}

function handleBrandChange(brand) {
    const checkbox = event.target;
    if (checkbox.checked) {
        currentFilters.brand = brand;
    } else {
        currentFilters.brand = null;
    }
}

// Apply filters
function applyFilters() {
    currentFilters.minPrice = document.getElementById('minPrice').value || null;
    currentFilters.maxPrice = document.getElementById('maxPrice').value || null;
    currentFilters.sort = document.getElementById('sortSelect').value;
    currentFilters.page = 1;
    loadProducts();
}

// Clear filters
function clearFilters() {
    currentFilters = {
        category: null,
        brand: null,
        minPrice: null,
        maxPrice: null,
        search: null,
        sort: 'featured',
        page: 1
    };
    
    // Reset UI
    document.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach(input => {
        input.checked = false;
    });
    document.getElementById('minPrice').value = '';
    document.getElementById('maxPrice').value = '';
    document.getElementById('sortSelect').value = 'featured';
    document.getElementById('searchInput').value = '';
    
    loadProducts();
}

// Search products
function searchProducts() {
    currentFilters.search = document.getElementById('searchInput').value;
    currentFilters.page = 1;
    loadProducts();
}

// Load products
async function loadProducts() {
    try {
        const params = new URLSearchParams();
        if (currentFilters.category) params.append('category', currentFilters.category);
        if (currentFilters.brand) params.append('brand', currentFilters.brand);
        if (currentFilters.minPrice) params.append('minPrice', currentFilters.minPrice);
        if (currentFilters.maxPrice) params.append('maxPrice', currentFilters.maxPrice);
        if (currentFilters.search) params.append('search', currentFilters.search);
        params.append('sort', currentFilters.sort);
        params.append('page', currentFilters.page);
        params.append('limit', 12);

        const response = await fetch(`/api/products?${params}`);
        const data = await response.json();

        // Update product count
        document.getElementById('productCount').textContent = `${data.pagination.total} 件の商品`;

        // Render products
        const productsGrid = document.getElementById('productsGrid');
        productsGrid.innerHTML = data.products.map(product => `
            <div class="bg-white rounded-lg shadow hover:shadow-lg transition-shadow">
                <div class="relative">
                    <img src="${product.image_url}" alt="${product.name}" 
                        class="w-full h-48 object-cover rounded-t-lg cursor-pointer"
                        onclick="showProductDetail('${product.slug}')">
                    ${product.is_featured ? `
                        <span class="absolute top-2 left-2 bg-red-500 text-white px-2 py-1 rounded text-sm">
                            おすすめ
                        </span>
                    ` : ''}
                    ${product.original_price > product.price ? `
                        <span class="absolute top-2 right-2 bg-green-500 text-white px-2 py-1 rounded text-sm">
                            ${Math.round((1 - product.price / product.original_price) * 100)}% OFF
                        </span>
                    ` : ''}
                </div>
                <div class="p-4">
                    <h3 class="font-semibold text-gray-800 mb-2 cursor-pointer hover:text-blue-600"
                        onclick="showProductDetail('${product.slug}')">
                        ${product.name}
                    </h3>
                    <p class="text-sm text-gray-600 mb-2 line-clamp-2">${product.description}</p>
                    <div class="flex items-center mb-2">
                        <div class="flex text-yellow-400">
                            ${renderStars(product.rating)}
                        </div>
                        <span class="ml-2 text-sm text-gray-600">(${product.review_count})</span>
                    </div>
                    <div class="flex items-center justify-between mb-3">
                        <div>
                            ${product.original_price > product.price ? `
                                <span class="text-sm text-gray-400 line-through">¥${product.original_price.toLocaleString()}</span>
                            ` : ''}
                            <span class="text-xl font-bold text-gray-800">¥${product.price.toLocaleString()}</span>
                        </div>
                    </div>
                    <div class="flex gap-2">
                        <button onclick="addToCart(${product.id})" 
                            class="flex-1 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition">
                            <i class="fas fa-cart-plus mr-2"></i>カートに追加
                        </button>
                        <button onclick="showProductDetail('${product.slug}')" 
                            class="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 transition">
                            <i class="fas fa-info-circle"></i>
                        </button>
                    </div>
                </div>
            </div>
        `).join('');

        // Render pagination
        renderPagination(data.pagination);
    } catch (error) {
        console.error('Error loading products:', error);
    }
}

// Render star rating
function renderStars(rating) {
    const fullStars = Math.floor(rating);
    const halfStar = rating % 1 >= 0.5;
    const emptyStars = 5 - fullStars - (halfStar ? 1 : 0);
    
    let stars = '';
    for (let i = 0; i < fullStars; i++) {
        stars += '<i class="fas fa-star"></i>';
    }
    if (halfStar) {
        stars += '<i class="fas fa-star-half-alt"></i>';
    }
    for (let i = 0; i < emptyStars; i++) {
        stars += '<i class="far fa-star"></i>';
    }
    return stars;
}

// Render pagination
function renderPagination(pagination) {
    const paginationDiv = document.getElementById('pagination');
    if (pagination.totalPages <= 1) {
        paginationDiv.innerHTML = '';
        return;
    }

    let html = '<div class="flex gap-2">';
    
    // Previous button
    if (pagination.page > 1) {
        html += `<button onclick="changePage(${pagination.page - 1})" 
            class="px-3 py-2 border rounded hover:bg-gray-100">
            <i class="fas fa-chevron-left"></i>
        </button>`;
    }

    // Page numbers
    for (let i = 1; i <= pagination.totalPages; i++) {
        if (i === pagination.page) {
            html += `<button class="px-3 py-2 bg-blue-600 text-white rounded">${i}</button>`;
        } else if (i === 1 || i === pagination.totalPages || Math.abs(i - pagination.page) <= 2) {
            html += `<button onclick="changePage(${i})" 
                class="px-3 py-2 border rounded hover:bg-gray-100">${i}</button>`;
        } else if (i === 2 || i === pagination.totalPages - 1) {
            html += '<span class="px-2 py-2">...</span>';
        }
    }

    // Next button
    if (pagination.page < pagination.totalPages) {
        html += `<button onclick="changePage(${pagination.page + 1})" 
            class="px-3 py-2 border rounded hover:bg-gray-100">
            <i class="fas fa-chevron-right"></i>
        </button>`;
    }

    html += '</div>';
    paginationDiv.innerHTML = html;
}

// Change page
function changePage(page) {
    currentFilters.page = page;
    loadProducts();
    window.scrollTo(0, 0);
}

// Show product detail
async function showProductDetail(slug) {
    try {
        const response = await fetch(`/api/products/${slug}`);
        const product = await response.json();

        const modal = document.getElementById('productModal');
        const modalContent = document.getElementById('modalContent');
        
        modalContent.innerHTML = `
            <div class="relative">
                <button onclick="closeModal()" class="absolute top-4 right-4 text-gray-500 hover:text-gray-700 z-10">
                    <i class="fas fa-times text-xl"></i>
                </button>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-8 p-8">
                    <div>
                        <img src="${product.image_url}" alt="${product.name}" class="w-full rounded-lg">
                        ${product.images && product.images.length > 0 ? `
                            <div class="grid grid-cols-4 gap-2 mt-4">
                                ${product.images.map(img => `
                                    <img src="${img}" alt="${product.name}" class="w-full h-20 object-cover rounded cursor-pointer hover:opacity-75">
                                `).join('')}
                            </div>
                        ` : ''}
                    </div>
                    <div>
                        <h2 class="text-2xl font-bold mb-2">${product.name}</h2>
                        <p class="text-gray-600 mb-4">${product.description}</p>
                        
                        <div class="flex items-center mb-4">
                            <div class="flex text-yellow-400">
                                ${renderStars(product.rating)}
                            </div>
                            <span class="ml-2 text-gray-600">${product.rating} (${product.review_count} レビュー)</span>
                        </div>

                        <div class="mb-6">
                            ${product.original_price > product.price ? `
                                <span class="text-lg text-gray-400 line-through">¥${product.original_price.toLocaleString()}</span>
                                <span class="ml-2 text-green-600 font-semibold">
                                    ${Math.round((1 - product.price / product.original_price) * 100)}% OFF
                                </span>
                                <br>
                            ` : ''}
                            <span class="text-3xl font-bold text-gray-800">¥${product.price.toLocaleString()}</span>
                        </div>

                        ${product.features && product.features.length > 0 ? `
                            <div class="mb-6">
                                <h3 class="font-semibold mb-2">特徴</h3>
                                <ul class="list-disc list-inside text-gray-600">
                                    ${product.features.map(feature => `<li>${feature}</li>`).join('')}
                                </ul>
                            </div>
                        ` : ''}

                        ${product.specifications ? `
                            <div class="mb-6">
                                <h3 class="font-semibold mb-2">仕様</h3>
                                <dl class="grid grid-cols-2 gap-2 text-sm">
                                    ${Object.entries(product.specifications).map(([key, value]) => `
                                        <dt class="text-gray-600">${key}:</dt>
                                        <dd class="font-medium">${value}</dd>
                                    `).join('')}
                                </dl>
                            </div>
                        ` : ''}

                        <div class="flex items-center gap-4 mb-4">
                            <div class="flex items-center">
                                <button onclick="decreaseQuantity()" class="px-3 py-1 border rounded-l">-</button>
                                <input type="number" id="modalQuantity" value="1" min="1" max="${product.stock}" 
                                    class="w-16 px-2 py-1 border-t border-b text-center">
                                <button onclick="increaseQuantity(${product.stock})" class="px-3 py-1 border rounded-r">+</button>
                            </div>
                            <span class="text-sm text-gray-600">在庫: ${product.stock} 個</span>
                        </div>

                        <button onclick="addToCartFromModal(${product.id})" 
                            class="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition">
                            <i class="fas fa-cart-plus mr-2"></i>カートに追加
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        modal.classList.remove('hidden');
    } catch (error) {
        console.error('Error loading product detail:', error);
    }
}

// Modal quantity controls
function decreaseQuantity() {
    const input = document.getElementById('modalQuantity');
    if (input.value > 1) {
        input.value = parseInt(input.value) - 1;
    }
}

function increaseQuantity(max) {
    const input = document.getElementById('modalQuantity');
    if (parseInt(input.value) < max) {
        input.value = parseInt(input.value) + 1;
    }
}

// Close modal
function closeModal() {
    document.getElementById('productModal').classList.add('hidden');
}

// Cart functions
async function loadCart() {
    try {
        const response = await fetch(`/api/cart/${sessionId}`);
        const data = await response.json();
        cart = data.items;
        updateCartUI();
    } catch (error) {
        console.error('Error loading cart:', error);
    }
}

async function addToCart(productId, quantity = 1) {
    try {
        const response = await fetch(`/api/cart/${sessionId}/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId, quantity })
        });

        if (response.ok) {
            await loadCart();
            showNotification('商品をカートに追加しました');
        } else {
            const error = await response.json();
            showNotification(error.error || 'エラーが発生しました', 'error');
        }
    } catch (error) {
        console.error('Error adding to cart:', error);
        showNotification('エラーが発生しました', 'error');
    }
}

async function addToCartFromModal(productId) {
    const quantity = parseInt(document.getElementById('modalQuantity').value);
    await addToCart(productId, quantity);
    closeModal();
}

async function updateCartItem(productId, quantity) {
    try {
        await fetch(`/api/cart/${sessionId}/update`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId, quantity })
        });
        await loadCart();
    } catch (error) {
        console.error('Error updating cart:', error);
    }
}

async function removeFromCart(productId) {
    try {
        await fetch(`/api/cart/${sessionId}/item/${productId}`, {
            method: 'DELETE'
        });
        await loadCart();
    } catch (error) {
        console.error('Error removing from cart:', error);
    }
}

function updateCartUI() {
    // Update cart count
    document.getElementById('cartCount').textContent = cart.length;

    // Update cart items
    const cartItemsDiv = document.getElementById('cartItems');
    if (cart.length === 0) {
        cartItemsDiv.innerHTML = '<p class="text-gray-500 text-center">カートは空です</p>';
        document.getElementById('cartTotal').textContent = '¥0';
        return;
    }

    cartItemsDiv.innerHTML = cart.map(item => `
        <div class="flex items-center gap-4 mb-4 pb-4 border-b">
            <img src="${item.image_url}" alt="${item.name}" class="w-20 h-20 object-cover rounded">
            <div class="flex-1">
                <h4 class="font-semibold">${item.name}</h4>
                <p class="text-gray-600">¥${item.price.toLocaleString()}</p>
                <div class="flex items-center mt-2">
                    <button onclick="updateCartItem(${item.product_id}, ${item.quantity - 1})" 
                        class="px-2 py-1 border rounded-l text-sm">-</button>
                    <span class="px-3 py-1 border-t border-b text-sm">${item.quantity}</span>
                    <button onclick="updateCartItem(${item.product_id}, ${item.quantity + 1})" 
                        class="px-2 py-1 border rounded-r text-sm">+</button>
                    <button onclick="removeFromCart(${item.product_id})" 
                        class="ml-4 text-red-500 hover:text-red-700">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            <div class="text-right">
                <p class="font-semibold">¥${(item.price * item.quantity).toLocaleString()}</p>
            </div>
        </div>
    `).join('');

    // Update total
    const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    document.getElementById('cartTotal').textContent = `¥${total.toLocaleString()}`;
}

function toggleCart() {
    const cartSidebar = document.getElementById('cartSidebar');
    cartSidebar.classList.toggle('translate-x-full');
}

async function checkout() {
    if (cart.length === 0) {
        showNotification('カートが空です', 'error');
        return;
    }

    // Simple checkout for demo
    const customerInfo = {
        sessionId,
        customerName: prompt('お名前を入力してください:') || 'テストユーザー',
        customerEmail: prompt('メールアドレスを入力してください:') || 'test@example.com',
        customerPhone: '090-1234-5678',
        shippingAddress: '東京都渋谷区1-1-1',
        paymentMethod: 'card'
    };

    try {
        const response = await fetch('/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(customerInfo)
        });

        if (response.ok) {
            const order = await response.json();
            showNotification(`注文が完了しました！注文番号: ${order.orderNumber}`, 'success');
            await loadCart();
            toggleCart();
        } else {
            showNotification('注文処理中にエラーが発生しました', 'error');
        }
    } catch (error) {
        console.error('Error during checkout:', error);
        showNotification('注文処理中にエラーが発生しました', 'error');
    }
}

// Notification system
function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `fixed top-20 right-4 px-6 py-3 rounded-lg shadow-lg z-50 ${
        type === 'success' ? 'bg-green-500' : 'bg-red-500'
    } text-white`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Handle Enter key on search input
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('searchInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            searchProducts();
        }
    });
});