const firebaseConfig = {
    apiKey: "AIzaSyDW8l23YKS0ozXlLB_020bkO1SPgT2byNQ",
    authDomain: "hisab-app-6cab6.firebaseapp.com",
    projectId: "hisab-app-6cab6",
    storageBucket: "hisab-app-6cab6.firebasestorage.app",
    messagingSenderId: "892569073271",
    appId: "1:892569073271:web:33d553016d01cbd205b872"
};

try {
    if (typeof firebase !== "undefined" && firebase.initializeApp) {
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
    }
} catch (e) {
    console.warn("Firebase initializeApp:", e);
}

const db = (typeof firebase !== "undefined" && typeof firebase.firestore === "function") ? firebase.firestore() : null;
const auth = (typeof firebase !== "undefined" && typeof firebase.auth === "function") ? firebase.auth() : null;

window.db = db;
window.auth = auth;

if (db && typeof db.enablePersistence === "function") {
    db.enablePersistence({ synchronizeTabs: true }).catch((error) => {
        console.log("Offline persistence:", error.code);
    });
}
