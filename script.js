import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs, addDoc, doc, getDoc, updateDoc, setDoc, runTransaction, writeBatch } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCh1Hc9xveKcuwjhFxt6nLZRdpcose9ftg",
    authDomain: "danvil-f9d47.firebaseapp.com",
    projectId: "danvil-f9d47",
    storageBucket: "danvil-f9d47.firebasestorage.app",
    messagingSenderId: "847152281023",
    appId: "1:847152281023:web:7610456546790a6947dd0a",
    measurementId: "G-K9LKBBCDB6"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let currentAdType = localStorage.getItem('currentAdType') || 'sell';
let currentOrderType = localStorage.getItem('currentOrderType') || 'buy';
let currentOrderFilter = localStorage.getItem('currentOrderFilter') || 'all';
let currentOrder = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const GUEST_UID = 'guest';

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing app...');
    initAuth();
    initUI();
    setupEventListeners();
});

function initUI() {
    console.log('Initializing UI...');
    const savedCurrency = localStorage.getItem('selectedCurrency') || 'TANZANIA';
    const currencyDisplay = document.getElementById('currency-display');
    if (currencyDisplay) currencyDisplay.textContent = savedCurrency;
    updateAdTypeButtons();
    const buyOrderBtn = document.querySelector(`.order-type-btn[onclick="switchOrderType('buy')"]`);
    const sellOrderBtn = document.querySelector(`.order-type-btn[onclick="switchOrderType('sell')"]`);
    if (buyOrderBtn) {
        buyOrderBtn.classList.toggle('active', currentOrderType === 'buy');
        buyOrderBtn.classList.toggle('inactive', currentOrderType !== 'buy');
    }
    if (sellOrderBtn) {
        sellOrderBtn.classList.toggle('active', currentOrderType === 'sell');
        sellOrderBtn.classList.toggle('inactive', currentOrderType !== 'sell');
    }
    const orderTab = document.querySelector(`.order-tab[onclick="switchOrderTab('${currentOrderFilter}')"]`);
    if (orderTab) orderTab.classList.add('active');
    loadAds();
}

function updateAdTypeButtons() {
    console.log(`Updating ad type buttons, currentAdType: ${currentAdType}`);
    const buyBtn = document.getElementById('buy-btn');
    const sellBtn = document.getElementById('sell-btn');
    if (buyBtn) {
        buyBtn.classList.toggle('active', currentAdType === 'sell');
        buyBtn.classList.toggle('inactive', currentAdType !== 'sell');
    }
    if (sellBtn) {
        sellBtn.classList.toggle('active', currentAdType === 'buy');
        sellBtn.classList.toggle('inactive', currentAdType !== 'buy');
    }
}

function initAuth() {
    console.log('Initializing Firebase auth...');
    onAuthStateChanged(auth, async (user) => {
        currentUser = user;
        if (user) {
            console.log(`User authenticated: ${user.uid}`);
            await ensureUserDocument(user.uid, user.displayName || 'User', user.email);
        } else {
            console.log('No authenticated user, using guest mode');
            await ensureUserDocument(GUEST_UID, 'Guest', 'guest@example.com');
        }
        await checkAndUpdateBalances();
        await loadUserProfile();
        await loadUserAds();
        await loadUserOrders();
        await loadAds();
    });
}

async function ensureUserDocument(userId, displayName, email) {
    console.log(`Ensuring user document for userId: ${userId}`);
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    if (!userDoc.exists()) {
        console.log(`Creating user document for ${userId}`);
        await setDoc(userRef, {
            uid: userId,
            displayName: displayName,
            email: email || 'guest@example.com',
            usdtBalance: 0,
            rubiBalance: 0,
            createdAt: new Date()
        });
    }
}

async function checkAndUpdateBalances() {
    const userId = currentUser ? currentUser.uid : GUEST_UID;
    console.log(`Checking and updating balances for userId: ${userId}`);
    const usdtBalanceElement = document.getElementById('usdt-balance');
    const rubiBalanceElement = document.getElementById('rubi-balance');
    if (usdtBalanceElement) usdtBalanceElement.classList.add('balance-updating');
    if (rubiBalanceElement) rubiBalanceElement.classList.add('balance-updating');
    
    try {
        const userDoc = await getDoc(doc(db, 'users', userId));
        if (userDoc.exists()) {
            const userData = userDoc.data();
            if (usdtBalanceElement) usdtBalanceElement.textContent = userData.usdtBalance?.toFixed(2) || '0.00';
            if (rubiBalanceElement) rubiBalanceElement.textContent = userData.rubiBalance?.toFixed(2) || '0.00';
            localStorage.setItem(`userProfile_${userId}`, JSON.stringify({ ...userData, uid: userId }));
            localStorage.setItem(`userProfileCacheTime_${userId}`, Date.now());
            console.log(`Balances updated for ${userId}: USDT=${userData.usdtBalance}, RUBI=${userData.rubiBalance}`);
        } else {
            console.warn(`User document not found for ${userId}, creating...`);
            await ensureUserDocument(userId, currentUser ? currentUser.displayName || 'User' : 'Guest', currentUser ? currentUser.email : 'guest@example.com');
            if (usdtBalanceElement) usdtBalanceElement.textContent = '0.00';
            if (rubiBalanceElement) rubiBalanceElement.textContent = '0.00';
        }
    } catch (error) {
        console.error(`Error updating balances for ${userId}:`, error);
        if (usdtBalanceElement) usdtBalanceElement.textContent = 'Error';
        if (rubiBalanceElement) rubiBalanceElement.textContent = 'Error';
    } finally {
        if (usdtBalanceElement) usdtBalanceElement.classList.remove('balance-updating');
        if (rubiBalanceElement) rubiBalanceElement.classList.remove('balance-updating');
    }
}

async function syncUserAdsBalance(userId) {
    console.log(`Syncing all active ads for userId: ${userId}`);
    try {
        const userDoc = await getDoc(doc(db, 'users', userId));
        if (!userDoc.exists()) {
            console.warn(`User document not found for ${userId}`);
            return;
        }
        const adsQuery = query(
            collection(db, 'ads'),
            where('ownerId', '==', userId),
            where('status', '==', 'active')
        );
        const querySnapshot = await getDocs(adsQuery);
        const batch = writeBatch(db);
        let updated = false;
        querySnapshot.forEach((doc) => {
            batch.update(doc.ref, { updatedAt: new Date() });
            updated = true;
        });
        if (updated) {
            await batch.commit();
            console.log(`Updated timestamps for ${querySnapshot.size} active ads for ${userId}`);
            localStorage.removeItem('ads_all');
            localStorage.removeItem('ads_all_CacheTime');
            localStorage.removeItem(`userAds_buy_${userId}`);
            localStorage.removeItem(`userAds_buy_CacheTime_${userId}`);
            localStorage.removeItem(`userAds_sell_${userId}`);
            localStorage.removeItem(`userAds_sell_CacheTime_${userId}`);
            await loadAds();
            await loadUserAds();
        } else {
            console.log(`No ad updates needed for ${userId}`);
        }
    } catch (error) {
        console.error(`Error syncing ads for ${userId}:`, error);
    }
}

window.signOut = async function () {
    console.log('Signing out...');
    const signOutBtn = document.querySelector('.buy-btn[onclick="signOut()"]');
    if (signOutBtn) {
        signOutBtn.disabled = true;
        signOutBtn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right: 8px;"></i> Signing Out...';
    }
    try {
        await signOut(auth);
        localStorage.clear();
        currentUser = null;
        await ensureUserDocument(GUEST_UID, 'Guest', 'guest@example.com');
        await checkAndUpdateBalances();
        window.location.href = 'index.html';
    } catch (error) {
        console.error('Sign out error:', error);
        await Swal.fire({
            icon: 'error',
            title: 'Sign Out Failed',
            text: 'Failed to sign out. Please try again.'
        });
        if (signOutBtn) {
            signOutBtn.disabled = false;
            signOutBtn.innerHTML = '<i class="fas fa-sign-out-alt" style="margin-right: 8px;"></i> Sign Out';
        }
    }
};

async function loadUserProfile(attempt = 1, maxAttempts = 3) {
    const userId = currentUser ? currentUser.uid : GUEST_UID;
    console.log(`Loading user profile for ${userId}, attempt ${attempt}...`);
    const profilePage = document.getElementById('profile-page');
    if (!profilePage) return;
    const profileSpinner = document.createElement('div');
    profileSpinner.className = 'spinner';
    profilePage.prepend(profileSpinner);
    try {
        const cachedProfile = JSON.parse(localStorage.getItem(`userProfile_${userId}`) || '{}');
        const cacheTime = localStorage.getItem(`userProfileCacheTime_${userId}`);
        const isCacheValid = cacheTime && (Date.now() - parseInt(cacheTime) < CACHE_DURATION) && cachedProfile.uid === userId;
        if (isCacheValid) {
            console.log(`Using cached profile for ${userId}`);
            renderUserProfile(cachedProfile);
            return;
        }
        const userDoc = await getDoc(doc(db, 'users', userId));
        if (userDoc.exists()) {
            const userData = userDoc.data();
            userData.uid = userId;
            localStorage.setItem(`userProfile_${userId}`, JSON.stringify(userData));
            localStorage.setItem(`userProfileCacheTime_${userId}`, Date.now());
            renderUserProfile(userData);
            console.log(`User profile loaded for ${userId}:`, userData);
        } else {
            console.log(`Creating new user document for ${userId}`);
            const newUserData = {
                uid: userId,
                displayName: currentUser ? currentUser.displayName || 'User' : 'Guest',
                email: currentUser ? currentUser.email : 'guest@example.com',
                usdtBalance: 0,
                rubiBalance: 0,
                createdAt: new Date()
            };
            await setDoc(doc(db, 'users', userId), newUserData);
            localStorage.setItem(`userProfile_${userId}`, JSON.stringify(newUserData));
            localStorage.setItem(`userProfileCacheTime_${userId}`, Date.now());
            renderUserProfile(newUserData);
        }
    } catch (error) {
        console.error(`Error loading user profile for ${userId} (attempt ${attempt}):`, error);
        if (attempt < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            return loadUserProfile(attempt + 1, maxAttempts);
        }
        await Swal.fire({
            icon: 'error',
            title: 'Profile Load Failed',
            text: 'Failed to load profile after multiple attempts.'
        });
        renderUserProfile({ displayName: 'Error', usdtBalance: 0, rubiBalance: 0, createdAt: new Date(), uid: userId });
    } finally {
        profileSpinner.remove();
    }
}

function renderUserProfile(userData) {
    console.log('Rendering user profile:', userData);
    const profileName = document.getElementById('profile-name');
    const profileAvatar = document.getElementById('profile-avatar');
    const profileJoinDate = document.getElementById('profile-join-date');
    const usdtBalance = document.getElementById('usdt-balance');
    const rubiBalance = document.getElementById('rubi-balance');
    if (profileName) profileName.textContent = userData.displayName || 'User';
    if (profileAvatar) profileAvatar.textContent = userData.displayName ? userData.displayName.charAt(0).toUpperCase() : 'U';
    if (profileJoinDate) profileJoinDate.textContent = `Member since ${new Date(userData.createdAt?.toDate?.() || userData.createdAt).getFullYear() || '...'}`;
    if (usdtBalance) usdtBalance.textContent = userData.usdtBalance?.toFixed(2) || '0.00';
    if (rubiBalance) rubiBalance.textContent = userData.rubiBalance?.toFixed(2) || '0.00';
}

async function loadAds() {
    const adsContainer = document.getElementById('ads-container');
    const spinner = document.getElementById('loading-spinner');
    const errorMsg = document.getElementById('error-message');
    if (!adsContainer || !spinner || !errorMsg) {
        console.error('Missing DOM elements: ads-container, loading-spinner, or error-message');
        return;
    }
    spinner.style.display = 'block';
    errorMsg.style.display = 'none';
    adsContainer.innerHTML = '';

    try {
        console.log('Loading all ads (buy and sell)...');
        const cacheKey = 'ads_all';
        const cachedAds = JSON.parse(localStorage.getItem(cacheKey) || '[]');
        const cacheTime = localStorage.getItem(`${cacheKey}_CacheTime`);
        const isCacheValid = cacheTime && (Date.now() - parseInt(cacheTime) < CACHE_DURATION);

        if (isCacheValid && cachedAds.length > 0) {
            console.log(`Using cached ads, count: ${cachedAds.length}`);
            cachedAds.forEach(ad => renderAdCard(ad.data, ad.id));
            return;
        }

        console.log('Fetching fresh ads from Firebase...');
        const adsQuery = query(
            collection(db, 'ads'),
            where('status', '==', 'active')
        );
        const querySnapshot = await getDocs(adsQuery);
        if (querySnapshot.empty) {
            console.log('No active ads found');
            errorMsg.textContent = 'No ads available at the moment.';
            errorMsg.style.display = 'block';
            return;
        }

        const ads = [];
        querySnapshot.forEach((doc) => {
            const ad = doc.data();
            ads.push({ id: doc.id, data: ad });
            renderAdCard(ad, doc.id);
        });
        console.log(`Fetched ${ads.length} ads`);
        localStorage.setItem(cacheKey, JSON.stringify(ads));
        localStorage.setItem(`${cacheKey}_CacheTime`, Date.now());
    } catch (error) {
        console.error('Error loading ads:', error);
        errorMsg.textContent = 'Failed to load ads. Please check your connection and try again.';
        errorMsg.style.display = 'block';
    } finally {
        spinner.style.display = 'none';
    }
}

function renderAdCard(ad, adId) {
    const adsContainer = document.getElementById('ads-container');
    if (!adsContainer) {
        console.error('ads-container not found');
        return;
    }
    const adCard = document.createElement('div');
    adCard.className = 'trader-card';
    adCard.onclick = () => window.showOrderModal(ad.type, ad, adId);
    let paymentMethodsHtml = ad.paymentMethods.map(method => {
        let dotClass = method.includes('M-pesa') ? 'mpesa' : method.includes('Tigo') ? 'tigo' : 'airtel';
        return `<div class="payment-method">${method}<div class="payment-dot ${dotClass}"></div></div>`;
    }).join('');
    const availableDisplay = ad.type === 'buy' ? `TSh ${(ad.availableAmount * ad.price).toFixed(2)}` : `${ad.availableAmount.toFixed(2)} RUBI`;
    adCard.innerHTML = `
        ${ad.isPromoted ? '<div class="promoted-badge">Promoted</div>' : ''}
        <div class="trader-header">
            <div class="trader-info">
                <div class="trader-avatar">${ad.ownerName.charAt(0).toUpperCase()}</div>
                <span class="trader-name">${ad.ownerName}</span>
                <span style="
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 50%;
                    padding: 1px;
                    background: linear-gradient(135deg, #d1d1d1, #a0a0a0);
                    box-shadow: 0 0 5px rgba(0,0,0,0.3);
                ">
                    <i class="fa-solid fa-circle-check" style="
                        color: grey;
                        font-size: 14px;
                        background: white;
                        border-radius: 50%;
                        padding: 2px;
                        box-shadow: inset 0 0 2px rgba(0,0,0,0.15);
                    "></i>
                </span>
            </div>
        </div>
        <div class="trader-stats">
            <span>Trade: ${ad.tradeCount} Trades (${ad.successRate}%)</span>
            <div class="success-rate">
                <i class="fa-solid fa-user-shield"></i>
                <span>${ad.completionRate}%</span>
            </div>
        </div>
        <div class="price-section">
            <div class="price-info">
                <div class="price">TSh ${ad.price.toFixed(2)}<span class="price-unit">/RUBI</span></div>
                <div class="payment-methods">${paymentMethodsHtml}</div>
            </div>
            <div class="time-limit">
                <i class="fa-solid fa-user-clock"></i>
                <span>${ad.timeLimit} min</span>
            </div>
        </div>
        <div class="limits">Limit ${ad.minAmount.toFixed(2)} - ${ad.maxAmount.toFixed(2)} TZS</div>
        <div class="available">Available ${availableDisplay}</div>
        <button class="buy-btn">${ad.type === 'buy' ? 'Sell' : 'Buy'}</button>
    `;
    adsContainer.appendChild(adCard);
    console.log(`Rendered ad card: ${adId}, type: ${ad.type}`);
}

window.showCreateAdModal = async function () {
    const userId = currentUser ? currentUser.uid : GUEST_UID;
    console.log(`Showing create ad modal for userId: ${userId}`);
    await checkAndUpdateBalances();
    const adTypeSelect = document.getElementById('ad-type');
    if (adTypeSelect) adTypeSelect.value = currentAdType;
    const adPrice = document.getElementById('ad-price');
    if (adPrice) adPrice.value = '';
    const adMin = document.getElementById('ad-min');
    if (adMin) adMin.value = '';
    const adMax = document.getElementById('ad-max');
    if (adMax) adMax.value = '';
    const adPayment = document.getElementById('ad-payment');
    if (adPayment) adPayment.value = 'M-pesa (Vodafone)';
    const adTime = document.getElementById('ad-time');
    if (adTime) adTime.value = '15';
    const adAvailable = document.getElementById('ad-available');
    if (adAvailable) {
        adAvailable.value = '';
        adAvailable.readOnly = false;
        adAvailable.placeholder = 'Enter available amount';
    }
    const createAdBtn = document.getElementById('create-ad-btn');
    if (createAdBtn) {
        createAdBtn.disabled = false;
        createAdBtn.textContent = 'Create Ad';
    }
    const createAdSpinner = document.getElementById('create-ad-spinner');
    if (createAdSpinner) createAdSpinner.style.display = 'none';
    await updateAvailableAmount();
    const createAdModal = document.getElementById('create-ad-modal');
    if (createAdModal) createAdModal.style.display = 'flex';
}

window.updateAvailableAmount = async function () {
    const userId = currentUser ? currentUser.uid : GUEST_UID;
    console.log(`Updating available amount display for userId: ${userId}`);
    const adType = document.getElementById('ad-type')?.value;
    const availableAmountInput = document.getElementById('ad-available');
    if (!adType || !availableAmountInput) {
        console.error('Ad type or available amount input not found');
        return;
    }
    try {
        const userDoc = await getDoc(doc(db, 'users', userId));
        const userData = userDoc.data();
        const availableBalance = adType === 'sell' ? userData.rubiBalance || 0 : userData.usdtBalance || 0;
        availableAmountInput.placeholder = `Max: ${availableBalance.toFixed(2)} ${adType === 'sell' ? 'RUBI' : 'TZS'}`;
        console.log(`Available balance for ${adType}: ${availableBalance}`);
    } catch (error) {
        console.error(`Error fetching user balance for ${userId}:`, error);
        availableAmountInput.placeholder = 'Error fetching balance';
    }
};

window.createAd = async function () {
    const userId = currentUser ? currentUser.uid : GUEST_UID;
    console.log(`Creating new ad for userId: ${userId}`);
    const submitBtn = document.getElementById('create-ad-btn');
    const spinner = document.getElementById('create-ad-spinner');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating...';
    }
    if (spinner) spinner.style.display = 'block';
    try {
        const type = document.getElementById('ad-type')?.value;
        const price = parseFloat(document.getElementById('ad-price')?.value);
        const minAmount = parseFloat(document.getElementById('ad-min')?.value);
        const maxAmount = parseFloat(document.getElementById('ad-max')?.value);
        const availableAmount = parseFloat(document.getElementById('ad-available')?.value);
        const paymentMethod = document.getElementById('ad-payment')?.value;
        const timeLimit = parseInt(document.getElementById('ad-time')?.value);

        if (!type || !price || price <= 0 || !minAmount || minAmount <= 0 || !maxAmount || maxAmount <= 0 || !availableAmount || availableAmount <= 0 || !timeLimit || timeLimit < 5) {
            throw new Error('Please fill all fields with valid values');
        }
        if (minAmount >= maxAmount) {
            throw new Error('Maximum amount must be greater than minimum amount');
        }
        if (availableAmount <= 0) {
            throw new Error('Available amount must be greater than 0');
        }

        const adsQuery = query(
            collection(db, 'ads'),
            where('ownerId', '==', userId),
            where('type', '==', type),
            where('status', '==', 'active')
        );
        const querySnapshot = await getDocs(adsQuery);
        if (!querySnapshot.empty) {
            throw new Error(`You already have an active ${type} ad. Only one ${type} ad is allowed per user.`);
        }

        await ensureUserDocument(userId, currentUser ? currentUser.displayName || 'User' : 'Guest', currentUser ? currentUser.email : 'guest@example.com');
        const userRef = doc(db, 'users', userId);
        const userDoc = await getDoc(userRef);
        const userData = userDoc.data();
        const availableBalance = type === 'sell' ? userData.rubiBalance || 0 : userData.usdtBalance || 0;
        const amountToDeduct = type === 'sell' ? availableAmount : availableAmount;

        if (amountToDeduct > availableBalance) {
            throw new Error(`Insufficient ${type === 'sell' ? 'RUBI' : 'TZS'} balance to create ad`);
        }

        await runTransaction(db, async (transaction) => {
            const adRef = doc(collection(db, 'ads'));
            await transaction.set(adRef, {
                ownerId: userId,
                ownerName: currentUser ? currentUser.displayName || 'User' : 'Guest',
                type,
                price,
                minAmount,
                maxAmount,
                paymentMethods: [paymentMethod],
                availableAmount: type === 'sell' ? availableAmount : availableAmount / price,
                timeLimit,
                status: 'active',
                isPromoted: false,
                tradeCount: 0,
                successRate: 100,
                completionRate: 100,
                createdAt: new Date(),
                updatedAt: new Date()
            });

            const balanceField = type === 'sell' ? 'rubiBalance' : 'usdtBalance';
            const newBalance = type === 'sell' ? userData.rubiBalance - availableAmount : userData.usdtBalance - availableAmount;
            await transaction.update(userRef, { [balanceField]: newBalance });

            console.log(`Ad created with ID: ${adRef.id} for ${userId}, ${balanceField} reduced by ${amountToDeduct} to ${newBalance}`);
        });

        localStorage.removeItem('ads_all');
        localStorage.removeItem('ads_all_CacheTime');
        localStorage.removeItem(`userAds_${type}_${userId}`);
        localStorage.removeItem(`userAds_${type}_CacheTime_${userId}`);
        localStorage.removeItem(`userProfile_${userId}`);
        localStorage.removeItem(`userProfileCacheTime_${userId}`);
        closeModal('create-ad-modal');
        await loadUserAds();
        await loadUserProfile();
        await loadAds();
        await Swal.fire({
            icon: 'success',
            title: 'Ad Created',
            text: 'Ad created successfully! Your balance has been updated.'
        });
    } catch (error) {
        console.error(`Error creating ad for ${userId}:`, error);
        await Swal.fire({
            icon: 'error',
            title: 'Ad Creation Failed',
            text: error.message || 'Failed to create ad.'
        });
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Create Ad';
        }
        if (spinner) spinner.style.display = 'none';
    }
};

async function loadUserAds() {
    const userId = currentUser ? currentUser.uid : GUEST_UID;
    console.log(`Loading user ads for type: ${currentAdType}, userId: ${userId}`);
    const adsContainer = document.getElementById('my-ads-container');
    const spinner = document.getElementById('my-ads-spinner');
    const errorMsg = document.getElementById('my-ads-error');
    if (!adsContainer || !spinner || !errorMsg) {
        console.error('Missing DOM elements for user ads');
        return;
    }
    adsContainer.innerHTML = '';
    spinner.style.display = 'block';
    errorMsg.style.display = 'none';
    try {
        const cachedUserAds = JSON.parse(localStorage.getItem(`userAds_${currentAdType}_${userId}`) || '[]');
        const cacheTime = localStorage.getItem(`userAds_${currentAdType}_CacheTime_${userId}`);
        const isCacheValid = cacheTime && (Date.now() - parseInt(cacheTime) < CACHE_DURATION);
        if (isCacheValid && cachedUserAds.length > 0) {
            console.log(`Using cached user ads for ${userId}, count: ${cachedUserAds.length}`);
            cachedUserAds.forEach(ad => renderUserAd(ad.data, ad.id));
            return;
        }
        const adsQuery = query(
            collection(db, 'ads'),
            where('ownerId', '==', userId),
            where('type', '==', currentAdType)
        );
        const querySnapshot = await getDocs(adsQuery);
        if (querySnapshot.empty) {
            errorMsg.textContent = 'You have no ads yet. Create one!';
            errorMsg.style.display = 'block';
            console.log(`No user ads found for ${userId}`);
            return;
        }
        const userAds = [];
        querySnapshot.forEach((doc) => {
            const ad = doc.data();
            userAds.push({ id: doc.id, data: ad });
            renderUserAd(ad, doc.id);
        });
        localStorage.setItem(`userAds_${currentAdType}_${userId}`, JSON.stringify(userAds));
        localStorage.setItem(`userAds_${currentAdType}_CacheTime_${userId}`, Date.now());
        console.log(`Fetched ${userAds.length} user ads for ${userId}`);
    } catch (error) {
        console.error(`Error loading user ads for ${userId}:`, error);
        errorMsg.textContent = 'Failed to load your ads.';
        errorMsg.style.display = 'block';
    } finally {
        spinner.style.display = 'none';
    }
}

function renderUserAd(ad, adId) {
    const adsContainer = document.getElementById('my-ads-container');
    if (!adsContainer) {
        console.error('my-ads-container not found');
        return;
    }
    const adItem = document.createElement('div');
    adItem.className = 'ad-item';
    const availableDisplay = ad.type === 'buy' ? `TSh ${(ad.availableAmount * ad.price).toFixed(2)}` : `${ad.availableAmount.toFixed(2)} RUBI`;
    adItem.innerHTML = `
        <div class="ad-header">
            <div class="ad-price">TSh ${ad.price.toFixed(2)}/RUBI</div>
            <div class="ad-status ${ad.status === 'active' ? 'status-active' : 'status-paused'}">${ad.status.charAt(0).toUpperCase() + ad.status.slice(1)}</div>
        </div>
        <div class="ad-limit">Limit: ${ad.minAmount.toFixed(2)} - ${ad.maxAmount.toFixed(2)} TZS</div>
        <div class="ad-payment"><span>Payment: ${ad.paymentMethods.join(', ')}</span></div>
        <div class="available">Available: ${availableDisplay}</div>
    `;
    adsContainer.appendChild(adItem);
    console.log(`Rendered user ad: ${adId}, type: ${ad.type}`);
}

window.showOrderModal = function (type, ad, adId) {
    console.log(`Showing order modal for ad: ${adId}, type: ${type}`);
    currentOrder = { type, ad, adId };
    const modal = document.getElementById('order-modal');
    const modalTitle = document.getElementById('order-modal-title');
    const orderPrice = document.getElementById('order-price');
    const paymentMethodSelect = document.getElementById('payment-method');
    const rubiAddressGroup = document.getElementById('rubi-address-group');
    const phoneNumberGroup = document.getElementById('phone-number-group');
    const receiverNameGroup = document.getElementById('receiver-name-group');
    if (modalTitle) modalTitle.textContent = type === 'buy' ? 'Sell RUBI' : 'Buy RUBI';
    if (orderPrice) orderPrice.textContent = `TSh ${ad.price.toFixed(2)}/RUBI`;
    if (paymentMethodSelect) paymentMethodSelect.innerHTML = ad.paymentMethods.map(method => `<option value="${method}">${method}</option>`).join('');
    if (document.getElementById('rubi-amount')) document.getElementById('rubi-amount').value = '';
    if (document.getElementById('rubi-address')) document.getElementById('rubi-address').value = '';
    if (document.getElementById('phone-number')) document.getElementById('phone-number').value = '';
    if (document.getElementById('receiver-name')) document.getElementById('receiver-name').value = '';
    if (document.getElementById('summary-amount')) document.getElementById('summary-amount').textContent = '0.00 RUBI';
    if (document.getElementById('summary-total')) document.getElementById('summary-total').textContent = 'TSh 0.00';
    if (document.getElementById('confirm-order-btn')) document.getElementById('confirm-order-btn').disabled = true;
    if (document.getElementById('order-modal-spinner')) document.getElementById('order-modal-spinner').style.display = 'none';
    if (rubiAddressGroup) rubiAddressGroup.style.display = type === 'sell' ? 'block' : 'none';
    if (phoneNumberGroup) phoneNumberGroup.style.display = type === 'buy' ? 'block' : 'none';
    if (receiverNameGroup) receiverNameGroup.style.display = type === 'buy' ? 'block' : 'none';
    if (modal) modal.style.display = 'flex';
    const rubiAmountInput = document.getElementById('rubi-amount');
    const rubiAddressInput = document.getElementById('rubi-address');
    const phoneNumberInput = document.getElementById('phone-number');
    const receiverNameInput = document.getElementById('receiver-name');
    if (rubiAmountInput) rubiAmountInput.addEventListener('input', calculateTotal);
    if (rubiAddressInput) rubiAddressInput.addEventListener('input', calculateTotal);
    if (phoneNumberInput) phoneNumberInput.addEventListener('input', calculateTotal);
    if (receiverNameInput) receiverNameInput.addEventListener('input', calculateTotal);
};

window.calculateTotal = function () {
    console.log('Calculating order total...');
    const rubiAmountInput = document.getElementById('rubi-amount');
    const summaryAmount = document.getElementById('summary-amount');
    const summaryTotal = document.getElementById('summary-total');
    const rubiAddress = document.getElementById('rubi-address');
    const phoneNumber = document.getElementById('phone-number');
    const receiverName = document.getElementById('receiver-name');
    const confirmOrderBtn = document.getElementById('confirm-order-btn');
    if (!rubiAmountInput || !summaryAmount || !summaryTotal || !confirmOrderBtn) {
        console.error('Missing elements for calculateTotal');
        return;
    }

    const rubiAmount = parseFloat(rubiAmountInput.value) || 0;
    const pricePerRubi = currentOrder.ad.price;
    const totalAmount = rubiAmount * pricePerRubi;
    summaryAmount.textContent = rubiAmount.toFixed(2) + ' RUBI';
    summaryTotal.textContent = 'TSh ' + totalAmount.toFixed(2);
    const rubiAddressValue = rubiAddress ? rubiAddress.value.trim() : '';
    const phoneNumberValue = phoneNumber ? phoneNumber.value.trim() : '';
    const receiverNameValue = receiverName ? receiverName.value.trim() : '';
    const isSellOrder = currentOrder.type === 'buy';

    const isSellOrderValid = isSellOrder && rubiAmount > 0 && phoneNumberValue && receiverNameValue;
    const isBuyOrderValid = !isSellOrder && rubiAmount > 0 && rubiAddressValue;

    confirmOrderBtn.disabled = !(isSellOrderValid || isBuyOrderValid);
    console.log(`Submit button ${confirmOrderBtn.disabled ? 'disabled' : 'enabled'}, Sell Order Valid: ${isSellOrderValid}, Buy Order Valid: ${isBuyOrderValid}`);
};

window.confirmOrder = async function (attempt = 1, maxAttempts = 3) {
    const userId = currentUser ? currentUser.uid : GUEST_UID;
    console.log(`Confirming order for userId: ${userId}, attempt ${attempt}`);
    const confirmBtn = document.getElementById('confirm-order-btn');
    const spinner = document.getElementById('order-modal-spinner');
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Processing...';
    }
    if (spinner) spinner.style.display = 'block';
    try {
        const rubiAmount = parseFloat(document.getElementById('rubi-amount')?.value);
        const rubiAddress = document.getElementById('rubi-address')?.value?.trim();
        const phoneNumber = document.getElementById('phone-number')?.value?.trim();
        const receiverName = document.getElementById('receiver-name')?.value?.trim();
        const paymentMethod = document.getElementById('payment-method')?.value;
        const totalAmount = rubiAmount * currentOrder.ad.price;

        if (!rubiAmount || rubiAmount <= 0) {
            throw new Error('Enter valid amount');
        }
        if (totalAmount < currentOrder.ad.minAmount) {
            throw new Error(`Amount below minimum (${currentOrder.ad.minAmount.toFixed(2)} TZS)`);
        }
        if (totalAmount > currentOrder.ad.maxAmount) {
            throw new Error(`Amount above maximum (${currentOrder.ad.maxAmount.toFixed(2)} TZS)`);
        }

        const orderData = {
            adId: currentOrder.adId,
            buyerId: currentOrder.type === 'sell' ? userId : currentOrder.ad.ownerId,
            sellerId: currentOrder.type === 'buy' ? userId : currentOrder.ad.ownerId,
            type: currentOrder.type,
            rubiAmount,
            price: currentOrder.ad.price,
            totalAmount,
            paymentMethod,
            status: 'pending',
            createdAt: new Date(),
            updatedAt: new Date()
        };

        if (currentOrder.type === 'buy') {
            if (!phoneNumber) throw new Error('Phone number required');
            if (!receiverName) throw new Error('Receiver name required');
            orderData.phoneNumber = phoneNumber;
            orderData.receiverName = receiverName;
        } else {
            if (!rubiAddress) throw new Error('RUBI address required');
            orderData.rubiAddress = rubiAddress;
        }

        let orderId;
        await runTransaction(db, async (transaction) => {
            await ensureUserDocument(userId, currentUser ? currentUser.displayName || 'User' : 'Guest', currentUser ? currentUser.email : 'guest@example.com');

            const adRef = doc(db, 'ads', currentOrder.adId);
            const adDoc = await transaction.get(adRef);
            if (!adDoc.exists()) throw new Error('Ad no longer exists');

            const adData = adDoc.data();
            const availableTZS = adData.type === 'buy' ? adData.availableAmount * adData.price : adData.availableAmount;
            if (adData.type === 'buy' && totalAmount > availableTZS) {
                throw new Error(`Not enough TZS available (TSh ${availableTZS.toFixed(2)})`);
            } else if (adData.type === 'sell' && rubiAmount > adData.availableAmount) {
                throw new Error(`Not enough RUBI available (${adData.availableAmount.toFixed(2)} RUBI)`);
            }

            const userRef = doc(db, 'users', userId);
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists()) throw new Error('User document not found');
            const userData = userDoc.data();

            let newUserBalance;
            let newAvailableAmount;
            if (currentOrder.type === 'buy') {
                const userBalance = userData.rubiBalance || 0;
                if (rubiAmount > userBalance) {
                    throw new Error('Insufficient RUBI balance');
                }
                newUserBalance = userBalance - rubiAmount;
                newAvailableAmount = adData.ownerId === userId ? adData.availableAmount - rubiAmount : adData.availableAmount - rubiAmount;
                transaction.update(userRef, { rubiBalance: newUserBalance });
            } else {
                const userBalance = userData.usdtBalance || 0;
                if (totalAmount > userBalance) {
                    throw new Error('Insufficient TZS balance');
                }
                newUserBalance = userBalance - totalAmount;
                newAvailableAmount = adData.ownerId === userId ? adData.availableAmount - rubiAmount : adData.availableAmount - rubiAmount;
                transaction.update(userRef, { usdtBalance: newUserBalance });
            }

            const orderRef = doc(collection(db, 'orders'));
            transaction.set(orderRef, orderData);

            transaction.update(adRef, { 
                availableAmount: newAvailableAmount,
                updatedAt: new Date()
            });

            orderId = orderRef.id;
        });

        console.log(`Order created with ID: ${orderId} for ${userId}, user balance and ad amount updated`);

        localStorage.removeItem('ads_all');
        localStorage.removeItem('ads_all_CacheTime');
        localStorage.removeItem(`orders_${currentOrderType}_${userId}`);
        localStorage.removeItem(`orders_${currentOrderType}_CacheTime_${userId}`);
        localStorage.removeItem(`userProfile_${userId}`);
        localStorage.removeItem(`userProfileCacheTime_${userId}`);
        localStorage.removeItem(`userAds_buy_${userId}`);
        localStorage.removeItem(`userAds_buy_CacheTime_${userId}`);
        localStorage.removeItem(`userAds_sell_${userId}`);
        localStorage.removeItem(`userAds_sell_CacheTime_${userId}`);

        closeModal('order-modal');
        await checkAndUpdateBalances();
        await loadUserOrders();
        await loadUserProfile();
        await loadAds();
        await Swal.fire({
            icon: 'success',
            title: 'Order Created',
            text: 'Order created successfully!'
        });
    } catch (error) {
        if (error.code === 'permission-denied' && attempt < maxAttempts) {
            console.warn(`Permission-denied error on attempt ${attempt} for ${userId}, retrying...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            return confirmOrder(attempt + 1, maxAttempts);
        }
        if (error.code === 'permission-denied') {
            console.warn(`Permission-denied error caught for ${userId}, checking if order and balance were updated...`);
            const orderQuery = query(
                collection(db, 'orders'),
                where('adId', '==', currentOrder.adId),
                where('createdAt', '>', new Date(Date.now() - 30000))
            );
            const userRef = doc(db, 'users', userId);
            const adRef = doc(db, 'ads', currentOrder.adId);
            const [orderSnapshot, userDoc, adDoc] = await Promise.all([
                getDocs(orderQuery),
                getDoc(userRef),
                getDoc(adRef)
            ]);
            if (!orderSnapshot.empty && userDoc.exists() && adDoc.exists()) {
                const userData = userDoc.data();
                const adData = adDoc.data();
                const order = orderSnapshot.docs[0].data();
                const expectedBalance = currentOrder.type === 'buy' 
                    ? (userData.rubiBalance || 0) 
                    : (userData.usdtBalance || 0);
                const inputAmount = currentOrder.type === 'buy' 
                    ? parseFloat(document.getElementById('rubi-amount')?.value) 
                    : parseFloat(document.getElementById('rubi-amount')?.value) * currentOrder.ad.price;
                const balanceUpdated = expectedBalance <= inputAmount;
                const adAmountCorrect = adData.availableAmount <= currentOrder.ad.availableAmount - order.rubiAmount;
                if (balanceUpdated && adAmountCorrect) {
                    console.log(`Order, balance, and ad amount updated despite permission error for ${userId}, treating as success`);
                    localStorage.removeItem('ads_all');
                    localStorage.removeItem('ads_all_CacheTime');
                    localStorage.removeItem(`orders_${currentOrderType}_${userId}`);
                    localStorage.removeItem(`orders_${currentOrderType}_CacheTime_${userId}`);
                    localStorage.removeItem(`userProfile_${userId}`);
                    localStorage.removeItem(`userProfileCacheTime_${userId}`);
                    localStorage.removeItem(`userAds_buy_${userId}`);
                    localStorage.removeItem(`userAds_buy_CacheTime_${userId}`);
                    localStorage.removeItem(`userAds_sell_${userId}`);
                    localStorage.removeItem(`userAds_sell_CacheTime_${userId}`);
                    await checkAndUpdateBalances();
                    await loadUserOrders();
                    await loadUserProfile();
                    await loadAds();
                    closeModal('order-modal');
                    await Swal.fire({
                        icon: 'success',
                        title: 'Order Created',
                        text: 'Order created successfully!'
                    });
                    return;
                }
            }
        }
        console.error(`Error creating order for ${userId}:`, error);
        await Swal.fire({
            icon: 'error',
            title: 'Order Creation Failed',
            text: error.message || 'Failed to create order. Please try again.'
        });
    } finally {
        if (confirmBtn) {
            confirmBtn.textContent = 'Submit';
            confirmBtn.disabled = true;
        }
        if (spinner) spinner.style.display = 'none';
    }
};

async function loadUserOrders(filter = currentOrderFilter) {
    const userId = currentUser ? currentUser.uid : GUEST_UID;
    console.log(`Loading user orders for ${userId}, filter: ${filter}, type: ${currentOrderType}`);
    const ordersContainer = document.getElementById('orders-container');
    const spinner = document.getElementById('orders-spinner');
    const errorMsg = document.getElementById('orders-error');
    if (!ordersContainer || !spinner || !errorMsg) {
        console.error('Missing DOM elements for orders');
        return;
    }
    ordersContainer.innerHTML = '';
    spinner.style.display = 'block';
    errorMsg.style.display = 'none';
    try {
        const cachedOrders = JSON.parse(localStorage.getItem(`orders_${currentOrderType}_${userId}`) || '[]');
        const cacheTime = localStorage.getItem(`orders_${currentOrderType}_CacheTime_${userId}`);
        const isCacheValid = cacheTime && (Date.now() - parseInt(cacheTime) < CACHE_DURATION);
        if (isCacheValid && cachedOrders.length > 0 && filter === currentOrderFilter) {
            console.log(`Using cached orders for ${userId}, count: ${cachedOrders.length}`);
            cachedOrders.filter(order => filter === 'all' || order.data.status === filter)
                .forEach(order => renderOrder(order.data, order.id));
            return;
        }
        const orderTypeToQuery = currentOrderType === 'buy' ? 'sell' : 'buy';
        let ordersQuery = query(collection(db, 'orders'), 
            where(currentOrderType === 'buy' ? 'sellerId' : 'buyerId', '==', userId),
            where('type', '==', orderTypeToQuery));
        if (filter !== 'all') {
            ordersQuery = query(ordersQuery, where('status', '==', filter));
        }
        const querySnapshot = await getDocs(ordersQuery);
        if (querySnapshot.empty) {
            errorMsg.textContent = 'No orders found.';
            errorMsg.style.display = 'block';
            console.log(`No orders found for ${userId}`);
            return;
        }
        const orders = [];
        querySnapshot.forEach((doc) => {
            const order = doc.data();
            orders.push({ id: doc.id, data: order });
            renderOrder(order, doc.id);
        });
        localStorage.setItem(`orders_${currentOrderType}_${userId}`, JSON.stringify(orders));
        localStorage.setItem(`orders_${currentOrderType}_CacheTime_${userId}`, Date.now());
        console.log(`Fetched ${orders.length} orders for ${userId}`);
        currentOrderFilter = filter;
        localStorage.setItem('currentOrderFilter', filter);
    } catch (error) {
        console.error(`Error loading orders for ${userId}:`, error);
        errorMsg.textContent = 'Failed to load orders. Please try again.';
        errorMsg.style.display = 'block';
    } finally {
        spinner.style.display = 'none';
    }
}

function renderOrder(order, orderId) {
    const ordersContainer = document.getElementById('orders-container');
    if (!ordersContainer) {
        console.error('orders-container not found');
        return;
    }
    const orderItem = document.createElement('div');
    orderItem.className = 'order-item';
    const orderDate = order.createdAt?.toDate?.() || new Date(order.createdAt);
    const dateStr = orderDate ? formatDate(orderDate) : 'Unknown date';
    const statusClass = order.status === 'completed' ? 'status-completed' : order.status === 'pending' ? 'status-pending' : 'status-cancelled';
    const displayType = order.type === 'buy' ? 'Sell' : 'Buy';

    orderItem.innerHTML = `
        <div class="order-header">
            <span class="order-id">Order #${orderId.substring(0, 6)}</span>
            <span class="order-date">${dateStr}</span>
        </div>
        <div class="order-details">
            <div class="order-amount">${displayType} ${order.rubiAmount.toFixed(2)} RUBI</div>
            <div class="order-price">@ TSh ${order.price.toFixed(2)}/RUBI</div>
        </div>
        <div class="order-status ${statusClass}">${order.status.charAt(0).toUpperCase() + order.status.slice(1)}</div>
    `;

    if (order.status === 'pending') {
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'order-actions';

        const chatBtn = document.createElement('button');
        chatBtn.className = 'action-btn chat-btn';
        chatBtn.textContent = 'Chat';
        chatBtn.onclick = (e) => {
            e.stopPropagation();
            console.log('Chat button clicked for order:', orderId);
        };
        actionsDiv.appendChild(chatBtn);

        orderItem.appendChild(actionsDiv);
    }

    ordersContainer.appendChild(orderItem);
    console.log(`Rendered order: ${orderId}, status: ${order.status}`);
}

// Modified: Updated showDepositModal to reset phone number and receiver name fields
window.showDepositModal = function () {
    console.log('Showing deposit modal...');
    const depositAmount = document.getElementById('deposit-amount');
    const depositPhone = document.getElementById('deposit-phone'); // New phone number field
    const depositReceiverName = document.getElementById('deposit-receiver-name'); // New receiver name field
    const depositBtn = document.getElementById('deposit-btn');
    const depositSpinner = document.getElementById('deposit-spinner');
    const depositModal = document.getElementById('deposit-modal');
    if (depositAmount) depositAmount.value = '';
    if (depositPhone) depositPhone.value = '';
    if (depositReceiverName) depositReceiverName.value = '';
    if (depositBtn) {
        depositBtn.disabled = false;
        depositBtn.textContent = 'Submit Payment';
    }
    if (depositSpinner) depositSpinner.style.display = 'none';
    if (depositModal) depositModal.style.display = 'flex';
};

window.showWithdrawModal = function () {
    console.log('Showing withdraw modal...');
    const withdrawAmount = document.getElementById('withdraw-amount');
    const walletAddress = document.getElementById('wallet-address');
    const withdrawBtn = document.getElementById('withdraw-btn');
    const withdrawSpinner = document.getElementById('withdraw-spinner');
    const withdrawModal = document.getElementById('withdraw-modal');
    if (withdrawAmount) withdrawAmount.value = '';
    if (walletAddress) walletAddress.value = '';
    if (withdrawBtn) {
        withdrawBtn.disabled = false;
        withdrawBtn.textContent = 'Withdraw';
    }
    if (withdrawSpinner) withdrawSpinner.style.display = 'none';
    if (withdrawModal) withdrawModal.style.display = 'flex';
};

// Modified: Updated showDepositRubiModal to reset RUBI address field
window.showDepositRubiModal = function () {
    console.log('Showing deposit Rubi modal...');
    const depositRubiAmount = document.getElementById('deposit-rubi-amount');
    const depositRubiAddress = document.getElementById('deposit-rubi-address'); // New RUBI address field
    const depositRubiBtn = document.getElementById('deposit-rubi-btn');
    const depositRubiSpinner = document.getElementById('deposit-rubi-spinner');
    const depositRubiModal = document.getElementById('deposit-rubi-modal');
    if (depositRubiAmount) depositRubiAmount.value = '';
    if (depositRubiAddress) depositRubiAddress.value = '';
    if (depositRubiBtn) {
        depositRubiBtn.disabled = false;
        depositRubiBtn.textContent = 'Submit Payment';
    }
    if (depositRubiSpinner) depositRubiSpinner.style.display = 'none';
    if (depositRubiModal) depositRubiModal.style.display = 'flex';
};

window.showWithdrawRubiModal = function () {
    console.log('Showing withdraw Rubi modal...');
    const withdrawRubiAmount = document.getElementById('withdraw-rubi-amount');
    const rubiPhone = document.getElementById('rubi-phone');
    const withdrawRubiBtn = document.getElementById('withdraw-rubi-btn');
    const withdrawRubiSpinner = document.getElementById('withdraw-rubi-spinner');
    const withdrawRubiModal = document.getElementById('withdraw-rubi-modal');
    if (withdrawRubiAmount) withdrawRubiAmount.value = '';
    if (rubiPhone) rubiPhone.value = '';
    if (withdrawRubiBtn) {
        withdrawRubiBtn.disabled = false;
        withdrawRubiBtn.textContent = 'Withdraw';
    }
    if (withdrawRubiSpinner) withdrawRubiSpinner.style.display = 'none';
    if (withdrawRubiModal) withdrawRubiModal.style.display = 'flex';
};

// Modified: Updated processDeposit to handle phone number and receiver name
window.processDeposit = async function () {
    const userId = currentUser ? currentUser.uid : GUEST_UID;
    console.log(`Processing deposit for userId: ${userId}`);
    const amount = parseFloat(document.getElementById('deposit-amount')?.value);
    const phoneNumber = document.getElementById('deposit-phone')?.value.trim();
    const receiverName = document.getElementById('deposit-receiver-name')?.value.trim();
    const submitBtn = document.getElementById('deposit-btn');
    const spinner = document.getElementById('deposit-spinner');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Processing...';
    }
    if (spinner) spinner.style.display = 'block';
    try {
        if (!amount || amount <= 0) {
            throw new Error('Please enter a valid deposit amount');
        }
        if (!phoneNumber || !/^\d{10,12}$/.test(phoneNumber)) {
            throw new Error('Please enter a valid phone number (10-12 digits)');
        }
        if (!receiverName) {
            throw new Error('Please enter a receiver name');
        }
        await ensureUserDocument(userId, currentUser ? currentUser.displayName || 'User' : 'Guest', currentUser ? currentUser.email : 'guest@example.com');
        await addDoc(collection(db, 'transactions'), {
            userId,
            type: 'deposit',
            currency: 'USDT',
            amount,
            phoneNumber,
            receiverName,
            status: 'pending',
            createdAt: new Date()
        });
        console.log(`Deposit transaction of ${amount} USDT created (pending) for ${userId}, phone: ${phoneNumber}, receiver: ${receiverName}`);
        await Swal.fire({
            icon: 'success',
            title: 'Deposit Submitted',
            text: 'Deposit request submitted. Awaiting confirmation.'
        });
        closeModal('deposit-modal');
    } catch (error) {
        console.error(`Error processing deposit for ${userId}:`, error);
        await Swal.fire({
            icon: 'error',
            title: 'Deposit Failed',
            text: error.message || 'Failed to process deposit.'
        });
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Payment';
        }
        if (spinner) spinner.style.display = 'none';
    }
};

// Modified: Updated processRubiDeposit to handle RUBI address
window.processRubiDeposit = async function () {
    const userId = currentUser ? currentUser.uid : GUEST_UID;
    console.log(`Processing Rubi deposit for userId: ${userId}`);
    const amount = parseFloat(document.getElementById('deposit-rubi-amount')?.value);
    const rubiAddress = document.getElementById('deposit-rubi-address')?.value.trim();
    const submitBtn = document.getElementById('deposit-rubi-btn');
    const spinner = document.getElementById('deposit-rubi-spinner');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Processing...';
    }
    if (spinner) spinner.style.display = 'block';
    try {
        if (!amount || amount <= 0) {
            throw new Error('Please enter a valid deposit amount');
        }
        if (!rubiAddress) {
            throw new Error('Please enter a valid RUBI address');
        }
        await ensureUserDocument(userId, currentUser ? currentUser.displayName || 'User' : 'Guest', currentUser ? currentUser.email : 'guest@example.com');
        await addDoc(collection(db, 'transactions'), {
            userId,
            type: 'deposit',
            currency: 'RUBI',
            amount,
            rubiAddress,
            status: 'pending',
            createdAt: new Date()
        });
        console.log(`Rubi deposit transaction of ${amount} RUBI created (pending) for ${userId}, address: ${rubiAddress}`);
        await Swal.fire({
            icon: 'success',
            title: 'Rubi Deposit Submitted',
            text: 'Rubi deposit request submitted. Awaiting confirmation.'
        });
        closeModal('deposit-rubi-modal');
    } catch (error) {
        console.error(`Error processing Rubi deposit for ${userId}:`, error);
        await Swal.fire({
            icon: 'error',
            title: 'Rubi Deposit Failed',
            text: error.message || 'Failed to process deposit.'
        });
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Payment';
        }
        if (spinner) spinner.style.display = 'none';
    }
};

window.processWithdrawal = async function () {
    const userId = currentUser ? currentUser.uid : GUEST_UID;
    console.log(`Processing withdrawal for userId: ${userId}`);
    const amount = parseFloat(document.getElementById('withdraw-amount')?.value);
    const walletAddress = document.getElementById('wallet-address')?.value.trim();
    const submitBtn = document.getElementById('withdraw-btn');
    const spinner = document.getElementById('withdraw-spinner');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Processing...';
    }
    if (spinner) spinner.style.display = 'block';
    try {
        if (!amount || amount <= 0) {
            throw new Error('Please enter a valid withdrawal amount');
        }
        if (!walletAddress) {
            throw new Error('Please enter a valid wallet address');
        }
        await ensureUserDocument(userId, currentUser ? currentUser.displayName || 'User' : 'Guest', currentUser ? currentUser.email : 'guest@example.com');
        const userRef = doc(db, 'users', userId);
        const userDoc = await getDoc(userRef);
        if (!userDoc.exists()) throw new Error('User document not found');
        const userData = userDoc.data();
        const userBalance = userData.usdtBalance || 0;
        if (amount > userBalance) {
            throw new Error('Insufficient TZS balance');
        }
        await addDoc(collection(db, 'transactions'), {
            userId,
            type: 'withdrawal',
            currency: 'USDT',
            amount,
            walletAddress,
            status: 'pending',
            createdAt: new Date()
        });
        console.log(`Withdrawal transaction of ${amount} USDT created (pending) for ${userId}`);
        await Swal.fire({
            icon: 'success',
            title: 'Withdrawal Submitted',
            text: 'Withdrawal request submitted. Awaiting confirmation.'
        });
        closeModal('withdraw-modal');
    } catch (error) {
        console.error(`Error processing withdrawal for ${userId}:`, error);
        await Swal.fire({
            icon: 'error',
            title: 'Withdrawal Failed',
            text: error.message || 'Failed to process withdrawal.'
        });
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Withdraw';
        }
        if (spinner) spinner.style.display = 'none';
    }
};

window.processRubiWithdrawal = async function () {
    const userId = currentUser ? currentUser.uid : GUEST_UID;
    console.log(`Processing Rubi withdrawal for userId: ${userId}`);
    const amount = parseFloat(document.getElementById('withdraw-rubi-amount')?.value);
    const phoneNumber = document.getElementById('rubi-phone')?.value.trim();
    const submitBtn = document.getElementById('withdraw-rubi-btn');
    const spinner = document.getElementById('withdraw-rubi-spinner');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Processing...';
    }
    if (spinner) spinner.style.display = 'block';
    try {
        if (!amount || amount <= 0) {
            throw new Error('Please enter a valid withdrawal amount');
        }
        if (!phoneNumber || !/^\d{10,12}$/.test(phoneNumber)) {
            throw new Error('Please enter a valid phone number');
        }
        await ensureUserDocument(userId, currentUser ? currentUser.displayName || 'User' : 'Guest', currentUser ? currentUser.email : 'guest@example.com');
        const userRef = doc(db, 'users', userId);
        const userDoc = await getDoc(userRef);
        if (!userDoc.exists()) throw new Error('User document not found');
        const userData = userDoc.data();
        const userBalance = userData.rubiBalance || 0;
        if (amount > userBalance) {
            throw new Error('Insufficient Rubi balance');
        }
        await addDoc(collection(db, 'transactions'), {
            userId,
            type: 'withdrawal',
            currency: 'RUBI',
            amount,
            phoneNumber,
            status: 'pending',
            createdAt: new Date()
        });
        console.log(`Rubi withdrawal transaction of ${amount} RUBI created (pending) for ${userId}`);
        await Swal.fire({
            icon: 'success',
            title: 'Rubi Withdrawal Submitted',
            text: 'Rubi withdrawal request submitted. Awaiting confirmation.'
        });
        closeModal('withdraw-rubi-modal');
    } catch (error) {
        console.error(`Error processing Rubi withdrawal for ${userId}:`, error);
        await Swal.fire({
            icon: 'error',
            title: 'Rubi Withdrawal Failed',
            text: error.message || 'Failed to process withdrawal.'
        });
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Withdraw';
        }
        if (spinner) spinner.style.display = 'none';
    }
};

function setupEventListeners() {
    console.log('Setting up event listeners...');
    const buyBtn = document.getElementById('buy-btn');
    const sellBtn = document.getElementById('sell-btn');
    if (buyBtn) {
        buyBtn.onclick = () => {
            console.log('Buy button clicked, setting currentAdType to sell');
            currentAdType = 'sell';
            currentOrderType = 'buy';
            localStorage.setItem('currentAdType', currentAdType);
            localStorage.setItem('currentOrderType', currentOrderType);
            updateAdTypeButtons();
            document.querySelectorAll('.order-type-btn').forEach(btn => {
                btn.classList.remove('active');
                btn.classList.add('inactive');
            });
            const buyOrderBtn = document.querySelector(`.order-type-btn[onclick="switchOrderType('buy')"]`);
            if (buyOrderBtn) {
                buyOrderBtn.classList.add('active');
                buyOrderBtn.classList.remove('inactive');
            }
            loadAds();
        };
    }
    if (sellBtn) {
        sellBtn.onclick = () => {
            console.log('Sell button clicked, setting currentAdType to buy');
            currentAdType = 'buy';
            currentOrderType = 'sell';
            localStorage.setItem('currentAdType', currentAdType);
            localStorage.setItem('currentOrderType', currentOrderType);
            updateAdTypeButtons();
            document.querySelectorAll('.order-type-btn').forEach(btn => {
                btn.classList.remove('active');
                btn.classList.add('inactive');
            });
            const sellOrderBtn = document.querySelector(`.order-type-btn[onclick="switchOrderType('sell')"]`);
            if (sellOrderBtn) {
                sellOrderBtn.classList.add('active');
                sellOrderBtn.classList.remove('inactive');
            }
            loadAds();
        };
    }
}

window.showPage = async function (pageId) {
    console.log(`Showing page: ${pageId}`);
    document.querySelectorAll('.page-section').forEach(section => section.classList.remove('active'));
    const page = document.getElementById(pageId);
    if (page) page.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    const navItem = document.querySelector(`.nav-item[onclick="showPage('${pageId}')"]`);
    if (navItem) navItem.classList.add('active');
    const userId = currentUser ? currentUser.uid : GUEST_UID;
    if (pageId === 'ads-page') await loadUserAds();
    else if (pageId === 'orders-page') await loadUserOrders();
    else if (pageId === 'profile-page') await checkAndUpdateBalances();
};

window.switchOrderTab = function (filter) {
    console.log(`Switching order tab to: ${filter}`);
    document.querySelectorAll('.order-tab').forEach(tab => tab.classList.remove('active'));
    const orderTab = document.querySelector(`.order-tab[onclick="switchOrderTab('${filter}')"]`);
    if (orderTab) orderTab.classList.add('active');
    loadUserOrders(filter);
};

window.switchOrderType = function (type) {
    console.log(`Switching order type to: ${type}`);
    currentOrderType = type;
    localStorage.setItem('currentOrderType', currentOrderType);
    document.querySelectorAll('.order-type-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.classList.add('inactive');
    });
    const orderTypeBtn = document.querySelector(`.order-type-btn[onclick="switchOrderType('${type}')"]`);
    if (orderTypeBtn) {
        orderTypeBtn.classList.add('active');
        orderTypeBtn.classList.remove('inactive');
    }
    loadUserOrders(currentOrderFilter);
};

window.switchAdType = function (type) {
    console.log(`Switching ad type to: ${type}`);
    currentAdType = type;
    localStorage.setItem('currentAdType', currentAdType);
    const userId = currentUser ? currentUser.uid : GUEST_UID;
    localStorage.removeItem(`userAds_${type}_${userId}`);
    localStorage.removeItem(`userAds_${type}_CacheTime_${userId}`);
    updateAdTypeButtons();
    loadUserAds();
};

window.closeModal = function (modalId) {
    console.log(`Closing modal: ${modalId}`);
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'none';
};

function formatDate(date) {
    return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}
