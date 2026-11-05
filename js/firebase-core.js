/**
 * ==============================================================================
 * js/firebase-core.js - Khởi tạo Firebase SDK & Các hàm bảo mật dùng chung
 * ==============================================================================
 * Tự động đọc cấu hình từ js/config.js. Không cần chỉnh sửa file này.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
    getFirestore,
    collection,
    doc,
    getDoc,
    setDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    deleteField,
    serverTimestamp,
    query,
    where,
    getDocs,
onSnapshot
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
    getAuth,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { FIREBASE_CONFIG } from "./config.js";

// Khởi tạo Firebase App từ config trung tâm
const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);
const auth = getAuth(app);

/**
 * Hàm khử mã độc HTML (Chống lỗ hổng Stored / Reflected XSS)
 */
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Hàm kiểm tra URL an toàn (Cho phép http, https và data:image base64 an toàn; chặn javascript: XSS)
 */
function sanitizeUrl(url) {
    if (!url) return '#';
    const trimmed = String(url).trim();
    if (/^https?:\/\//i.test(trimmed) || /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(trimmed)) {
        return escapeHtml(trimmed);
    }
    return '#';
}

export {
    app,
    db,
    auth,
    collection,
    doc,
    getDoc,
    setDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    deleteField,
    serverTimestamp,
    query,
    where,
    getDocs,
    onSnapshot,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    escapeHtml,
    sanitizeUrl
};

