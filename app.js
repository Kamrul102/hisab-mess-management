// Global fallback references for Firebase services
var auth = (typeof window !== "undefined" && window.auth) ? window.auth : (typeof auth !== "undefined" ? auth : null);
var db = (typeof window !== "undefined" && window.db) ? window.db : (typeof db !== "undefined" ? db : null);

const KEY = "hisab_guideline_v1";

let state = JSON.parse(localStorage.getItem(KEY) || "null") || {
    messCode: "",
    user: null,
    verification: null,
    manager: "Not set",
    managerPhone: "",
    members: ["Member 1", "Member 2", "Member 3"],
    managerRole: false,
    managerPin: null,
    managerUnlocked: false,
    menu: {
        meal1: [],
        meal2: []
    },
    menuOptions: ["ভাত", "মাছ", "ডাল", "ডিম", "মুরগি"],
    meals: {},
    entries: [],
    history: [],
    notices: [],
    language: "en",
    mealTimes: {
        meal1: "10:00",
        meal2: "20:00"
    },
    privacy: "private",
    memberPhones: {}
};

if (!state.messCode) {
    state.messCode = localStorage.getItem("messCode") || "";
}

console.log("MESS CODE:", state.messCode);
console.log("STATE MESS CODE:", state.messCode);
console.log("LOCAL STORAGE MESS CODE:", localStorage.getItem("messCode"));
console.log("ALL LOCAL STORAGE:", localStorage);
/* =========================================================
   DATA MIGRATION / DEFAULTS
========================================================= */

if (!state.mealTimes) {
    state.mealTimes = {
        meal1: "10:00",
        meal2: "20:00"
    };
}

if (state.mealTimes.meal1 === undefined) {
    state.mealTimes.meal1 = "10:00";
}

if (state.mealTimes.meal2 === undefined) {
    state.mealTimes.meal2 = "20:00";
}

if (!state.menu || typeof state.menu !== "object") {
    state.menu = { meal1: [], meal2: [] };
}
if (!Array.isArray(state.menu.meal1)) state.menu.meal1 = [];
if (!Array.isArray(state.menu.meal2)) state.menu.meal2 = [];

const DEFAULT_MENU_OPTIONS = ["ভাত", "মাছ", "ডাল", "ডিম", "মুরগি"];
if (!Array.isArray(state.menuOptions)) state.menuOptions = [];
state.menuOptions = Array.from(new Set(DEFAULT_MENU_OPTIONS.concat(state.menuOptions).filter(Boolean)));

if (state.managerPhone === undefined) {
    state.managerPhone = "";
}

if (state.privacy === undefined) {
    state.privacy = "private";
}

if (!state.memberPhones) {
    state.memberPhones = {};
}

if (!state.members) {
    state.members = [];
}

if (!state.meals) {
    state.meals = {};
}

if (!state.entries) {
    state.entries = [];
}

if (!state.history) {
    state.history = [];
}

if (!state.notices) {
    state.notices = [];
}


/* =========================================================
   SAVE
========================================================= */

async function save() {
    if (isDemoMode) {
        return;
    }

    localStorage.setItem(KEY, JSON.stringify(state));

    /*
       OFFLINE: don't even attempt the network call — that would
       just hang/fail slowly. Local (localStorage) save above has
       already happened, so the app keeps working normally; we
       just remember that Firebase needs this data once we're back
       online (see OFFLINE SUPPORT / flushPendingSync()).
    */
    if (!navigator.onLine) {
        pendingSync = true;
        updateOfflineIndicator();
        console.log("Offline: saved locally, Firebase sync pending");
        return;
    }

    try {
        if (!auth.currentUser) {
            console.log("Firebase save skipped: user not logged in");
            return;
        }

        const messCode =
            state.messCode ||
            localStorage.getItem("messCode");

        if (!messCode) {

            /*
               Per spec: a mess code is only ever created when a brand
               new mess is actually created (see createAccount()).
               save() must never invent one on its own — if we reach
               this point with no mess code, login/onAuthStateChanged
               failed to restore it from the user's profile. Skip the
               Firestore write and keep working from localStorage
               until that's resolved, rather than silently spawning
               an orphan mess.
            */

            console.log("Firebase save skipped: mess code not found");
            return;
        }

        await db.collection("messes")
            .doc(messCode)
            .set({
                ...state,
                messCode: messCode,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, {
                merge: true
            });

        console.log(
            "Firebase data saved successfully:",
            messCode
        );

        pendingSync = false;
        updateOfflineIndicator();

        /*
           Keep the user's own profile doc (users/{uid}) in sync too:
           - messCode, so logins from any device/browser can find
             this mess.
           - the editable profile fields (name/phone/email/birthday/
             photo), so changes made via Profile/Settings are
             reflected on the user's own Firestore document, not
             only inside the shared mess document.
        */

        try {

            const profileUpdate = {
                messCode: messCode
            };

            if (state.user) {
                profileUpdate.name = state.user.name || "";
                profileUpdate.phone = state.user.phone || "";
                profileUpdate.email = state.user.email || "";
                profileUpdate.birthday = state.user.birthday || "";
                profileUpdate.photo = state.user.photo || null;
            }

            await db.collection("users")
                .doc(auth.currentUser.uid)
                .set(profileUpdate, { merge: true });

        } catch (syncErr) {
            console.error("Failed to sync user profile:", syncErr);
        }

    } catch (error) {
        console.error("Firebase save failed:", error);
        pendingSync = true;
        updateOfflineIndicator();
    }
}

/* =========================================================
   LOAD MESS DATA FROM FIREBASE
========================================================= */

async function loadMessData() {

    /*
       OFFLINE: nothing to load from the network. Whatever is
       already in `state` (restored from localStorage at the top
       of this file) is what the app runs on until we're back
       online.
    */
    if (!navigator.onLine) {
        console.log("Mess data load skipped: offline, using local cache");
        return false;
    }

    try {

        if (!auth.currentUser) {
            console.log("Mess data load skipped: user not logged in");
            return false;
        }

        const messCode =
            state.messCode ||
            localStorage.getItem("messCode");

        if (!messCode) {
            console.log("Mess data load skipped: mess code not found");
            return false;
        }

        console.log(
            "Loading mess data from Firebase:",
            messCode
        );

        const messDoc = await db
            .collection("messes")
            .doc(messCode)
            .get();

        if (!messDoc.exists) {

            console.log(
                "Mess document not found:",
                messCode
            );

            return false;
        }

        const messData = messDoc.data();

        console.log(
            "Firebase mess data:",
            messData
        );

        /*
         * Restore mess data
         *
         * For collections (arrays/objects), only overwrite local
         * state when Firebase actually has non-empty data — an
         * empty array/object from a half-written or stale mess
         * document should not wipe out data that's already here.
         */

        if (Array.isArray(messData.members) && messData.members.length > 0) {
            state.members = messData.members;
        }

        if (messData.manager !== undefined) {
            state.manager = messData.manager;
        }

        if (messData.managerPhone !== undefined) {
            state.managerPhone = messData.managerPhone;
        }

        if (messData.managerRole !== undefined) {
            state.managerRole = messData.managerRole;
        }

        if (messData.managerPin !== undefined) {
            state.managerPin = messData.managerPin;
        }

        if (
            messData.meals &&
            typeof messData.meals === "object" &&
            Object.keys(messData.meals).length > 0
        ) {
            state.meals = messData.meals;
        }

        if (Array.isArray(messData.entries) && messData.entries.length > 0) {
            state.entries = messData.entries;
        }

        if (Array.isArray(messData.history) && messData.history.length > 0) {
            state.history = messData.history;
        }

        if (Array.isArray(messData.notices) && messData.notices.length > 0) {
            state.notices = messData.notices;
        }

        if (messData.mealTimes) {
            state.mealTimes = messData.mealTimes;
        }

        if (messData.menu && typeof messData.menu === "object") {
            state.menu = {
                meal1: Array.isArray(messData.menu.meal1) ? messData.menu.meal1 : [],
                meal2: Array.isArray(messData.menu.meal2) ? messData.menu.meal2 : []
            };
        }

        if (Array.isArray(messData.menuOptions)) {
            state.menuOptions = Array.from(new Set(DEFAULT_MENU_OPTIONS.concat(messData.menuOptions).filter(Boolean)));
        }

        if (messData.privacy !== undefined) {
            state.privacy = messData.privacy;
        }

        if (
            messData.memberPhones &&
            typeof messData.memberPhones === "object" &&
            Object.keys(messData.memberPhones).length > 0
        ) {
            state.memberPhones = messData.memberPhones;
        }

        if (messData.language !== undefined) {
            state.language = messData.language;
        }

        /*
           NOTE: managerUnlocked is intentionally NOT restored from
           Firebase. Whether the Manager PIN is unlocked should stay
           local to this browser/session, not follow the account
           across devices — otherwise a fresh login could silently
           inherit an unlocked manager panel.
        */

        localStorage.setItem(KEY, JSON.stringify(state));

        console.log(
            "Mess data loaded successfully:",
            messCode
        );

        return true;

    } catch (error) {
        console.error("Failed to load mess data:", error);
        return false;
    }
}

let messListenerUnsubscribe = null;

function startMessRealtimeListener(messCode) {
    if (!messCode || typeof db === "undefined" || !db) return;
    if (messListenerUnsubscribe) {
        messListenerUnsubscribe();
        messListenerUnsubscribe = null;
    }

    try {
        messListenerUnsubscribe = db.collection("messes").doc(messCode).onSnapshot(function(docSnapshot) {
            if (!docSnapshot || !docSnapshot.exists) return;
            const remote = docSnapshot.data();
            if (!remote) return;

            if (Array.isArray(remote.members) && remote.members.length > 0) {
                state.members = remote.members;
            }
            if (remote.manager !== undefined) state.manager = remote.manager;
            if (remote.managerPhone !== undefined) state.managerPhone = remote.managerPhone;
            if (remote.managerPin !== undefined) state.managerPin = remote.managerPin;

            if (remote.meals && typeof remote.meals === "object") {
                state.meals = Object.assign({}, state.meals || {}, remote.meals);
            }

            if (Array.isArray(remote.entries)) {
                state.entries = mergeById(remote.entries, state.entries || []).sort(function(a, b) {
                    return (a.ts || 0) - (b.ts || 0);
                });
            }

            if (Array.isArray(remote.history)) {
                state.history = mergeById(remote.history, state.history || []).sort(function(a, b) {
                    return (b.ts || 0) - (a.ts || 0);
                }).slice(0, 100);
            }

            if (Array.isArray(remote.notices)) {
                state.notices = mergeById(remote.notices, state.notices || []).sort(function(a, b) {
                    return (b.ts || 0) - (a.ts || 0);
                });
            }

            if (remote.menu && typeof remote.menu === "object") state.menu = remote.menu;
            if (remote.mealTimes) state.mealTimes = remote.mealTimes;
            if (Array.isArray(remote.menuOptions)) state.menuOptions = remote.menuOptions;
            if (remote.privacy !== undefined) state.privacy = remote.privacy;
            if (remote.memberPhones && typeof remote.memberPhones === "object") {
                state.memberPhones = Object.assign({}, state.memberPhones || {}, remote.memberPhones);
            }

            if (state.user) {
                state.managerRole = (state.manager === state.user.name);
            }

            localStorage.setItem(KEY, JSON.stringify(state));
            if (typeof renderAll === "function") {
                renderAll();
            }
        }, function(err) {
            console.warn("Realtime mess listener warning:", err);
        });
    } catch (e) {
        console.warn("Could not attach realtime listener:", e);
    }
}

/* =========================================================
   OFFLINE SUPPORT

   - App always keeps working from localStorage, online or not
     (see `state` init + save() at top of file).
   - `pendingSync` tracks whether local changes exist that Firebase
     hasn't seen yet (made while offline, or a Firebase write that
     failed).
   - When the browser comes back online, flushPendingSync() pulls
     the latest remote copy of the shared arrays (entries/history/
     notices) and merges them with local changes by `id` before
     saving, so two members editing on different devices while
     offline don't wipe out each other's entries (conflict
     handling). Non-array fields (meals, members, settings, etc.)
     keep the existing merge:true / last-write-wins behaviour.
========================================================= */

let pendingSync = false;

function ensureOfflineIndicator() {
    let el = document.getElementById("offlineIndicator");

    if (!el) {
        el = document.createElement("div");
        el.id = "offlineIndicator";
        el.style.cssText =
            "position:fixed;top:0;left:0;right:0;z-index:99999;" +
            "text-align:center;padding:6px 10px;font-size:13px;" +
            "font-weight:600;display:none;font-family:inherit;";

        document.body.appendChild(el);
    }

    return el;
}

function updateOfflineIndicator() {
    const el = ensureOfflineIndicator();

    if (!navigator.onLine) {
        el.textContent =
            "🔌 Internet নেই — Offline Mode-এ কাজ চলছে (Local-এ সেভ হচ্ছে)";
        el.style.background = "#c0392b";
        el.style.color = "#fff";
        el.style.display = "block";

    } else if (pendingSync) {
        el.textContent =
            "🔄 Internet ফিরেছে — পুরোনো পরিবর্তনগুলো Sync হচ্ছে...";
        el.style.background = "#f39c12";
        el.style.color = "#fff";
        el.style.display = "block";

    } else {
        el.style.display = "none";
    }
}

function mergeById(remoteArr, localArr) {
    const map = new Map();

    (Array.isArray(remoteArr) ? remoteArr : []).forEach(function(item) {
        if (item && item.id) {
            map.set(item.id, item);
        }
    });

    /*
       Local copies win over remote on id collisions, since local
       is what this device actually just did.
    */
    (Array.isArray(localArr) ? localArr : []).forEach(function(item) {
        if (item && item.id) {
            map.set(item.id, item);
        }
    });

    /*
       Older records (from before this feature existed) have no
       `id` — keep them too, just can't dedupe/merge them by id.
    */
    (Array.isArray(remoteArr) ? remoteArr : [])
    .concat(Array.isArray(localArr) ? localArr : [])
        .forEach(function(item) {
            if (item && !item.id) {
                const _id = generateId();
                item.id = _id;
                map.set(_id, item);
            }
        });

    return Array.from(map.values());
}

async function flushPendingSync() {
    if (!navigator.onLine) return;
    if (!pendingSync) return;
    if (!auth.currentUser) return;

    const messCode =
        state.messCode ||
        localStorage.getItem("messCode");

    if (!messCode) return;

    console.log("Back online — merging offline changes with Firebase");

    try {
        const messDoc = await db.collection("messes").doc(messCode).get();

        if (messDoc.exists) {
            const remote = messDoc.data();

            state.entries =
                mergeById(remote.entries, state.entries)
                .sort(function(a, b) {
                    return (a.ts || 0) - (b.ts || 0);
                });

            state.history =
                mergeById(remote.history, state.history)
                .sort(function(a, b) {
                    return (b.ts || 0) - (a.ts || 0);
                })
                .slice(0, 100);

            state.notices =
                mergeById(remote.notices, state.notices)
                .sort(function(a, b) {
                    return (b.ts || 0) - (a.ts || 0);
                });
        }

    } catch (err) {
        console.error(
            "Merge before sync failed, syncing local state as-is:",
            err
        );
    }

    await save();

    renderAll();

    console.log("Offline changes synced successfully.");
}

window.addEventListener("online", function() {
    console.log("Network: back online");
    updateOfflineIndicator();
    flushPendingSync();
});

window.addEventListener("offline", function() {
    console.log("Network: offline");
    pendingSync = true;
    updateOfflineIndicator();
});

if (document.readyState === "loading") {
    document.addEventListener(
        "DOMContentLoaded",
        updateOfflineIndicator
    );
} else {
    updateOfflineIndicator();
}


/* =========================================================
   DATE / TEXT HELPERS
========================================================= */

function today() {
    return new Date().toISOString().slice(0, 10);
}

function todayKey() {
    return new Date().toISOString().slice(0, 10);
}

function initials(name) {
    return (name || "?").trim().charAt(0).toUpperCase();
}

/*
   Unique id for entries/history/notices records. Needed so that,
   after being offline, local records made on this device and
   remote records made on another device can be merged together
   without duplicating or losing anything (see OFFLINE SUPPORT).
*/
function generateId() {
    return (
        Date.now().toString(36) +
        "_" +
        Math.random().toString(36).slice(2, 9)
    );
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function(m) {
        return {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        }[m];
    });
}

function escapeJs(s) {
    return String(s)
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'");
}


/* =========================================================
   AUTH
========================================================= */

function showLogin() {
    document.getElementById("loginForm").classList.remove("hidden");
    document.getElementById("createForm").classList.add("hidden");
}

function showCreate() {
    document.getElementById("loginForm").classList.add("hidden");
    document.getElementById("createForm").classList.remove("hidden");

    /*
       Always start the Create Account form on "Create New Mess" by
       default, and clear any leftover Mess Code from a previous
       attempt.
    */
    const createRadio =
        document.getElementById("messModeCreate");

    if (createRadio) {
        createRadio.checked = true;
    }

    const joinCodeInput =
        document.getElementById("joinMessCode");

    if (joinCodeInput) {
        joinCodeInput.value = "";
    }

    setMessMode("create");
}

function previewCreatePhoto(event) {
    const file = event.target.files && event.target.files[0];

    const img = document.getElementById("createAvatarPreview");
    const icon = document.getElementById("createAvatarIcon");

    if (!file) {
        img.src = "";
        img.classList.add("hidden");
        icon.classList.remove("hidden");
        return;
    }

    const reader = new FileReader();

    reader.onload = function() {
        img.src = reader.result;
        img.classList.remove("hidden");
        icon.classList.add("hidden");
    };

    reader.readAsDataURL(file);
}


/* =========================================================
   EMAILJS
========================================================= */

const EMAILJS_SERVICE_ID = (window.EMAILJS_CONFIG && window.EMAILJS_CONFIG.serviceId) || "";
const EMAILJS_TEMPLATE_ID = (window.EMAILJS_CONFIG && window.EMAILJS_CONFIG.templateId) || "";
const EMAILJS_PUBLIC_KEY = (window.EMAILJS_CONFIG && window.EMAILJS_CONFIG.publicKey) || "";

if (typeof emailjs !== "undefined" && EMAILJS_PUBLIC_KEY) {
    emailjs.init({
        publicKey: EMAILJS_PUBLIC_KEY
    });
}

let pendingVerificationCode = null;


/* =========================================================
   CREATE ACCOUNT - FIREBASE
========================================================= */

/*
   Which mode the Create Account form is in: "create" (default) or
   "join". Set by the radio buttons in the Create Account UI via
   setMessMode(). Read here by createAccount()/startVerification().
*/
let messMode = "create";

function setMessMode(mode) {
    messMode =
        (mode === "join") ? "join" : "create";

    const joinRow =
        document.getElementById("joinMessCodeRow");

    if (joinRow) {
        joinRow.classList.toggle(
            "hidden",
            messMode !== "join"
        );
    }
}

/*
   Reset local mess-specific state back to fresh defaults before
   starting a brand new mess. Without this, if this browser/device
   still has another mess's data cached locally (localStorage) from
   before, a newly created mess could start out polluted with that
   old mess's members/meals/entries instead of being empty.
*/
function resetLocalMessState() {
    state.members = [];
    state.memberPhones = {};
    state.meals = {};
    state.entries = [];
    state.history = [];
    state.notices = [];
    state.mealTimes = {
        meal1: "10:00",
        meal2: "20:00"
    };
    state.menu = {
        meal1: [],
        meal2: []
    };
    state.menuOptions = DEFAULT_MENU_OPTIONS.slice();
    state.privacy = "private";
    state.manager = "Not set";
    state.managerPhone = "";
    state.managerPin = null;
    state.managerUnlocked = false;
}

async function createAccount() {

    const name =
        document.getElementById("createName").value.trim();

    const phone =
        document.getElementById("createPhone").value.trim();

    const email =
        document.getElementById("createEmail").value.trim();

    const birthday =
        document.getElementById("createBirthday").value;

    const password =
        document.getElementById("createPassword").value;

    const confirm =
        document.getElementById("createConfirm").value;


    if (!name || !phone || !email || !birthday || !password) {
        alert("Please fill in all required fields.");
        return;
    }


    if (password !== confirm) {
        alert("Passwords do not match.");
        return;
    }


    if (!auth) {
        alert("Firebase Authentication is not available.");
        return;
    }


    /*
       JOIN MODE: validate the Mess Code exists in Firestore BEFORE
       any Firebase Auth account is created, so an invalid code
       creates nothing at all (per spec TEST 6).
    */

    let joinMessCode = null;

    if (messMode === "join") {

        const joinInput =
            document.getElementById("joinMessCode");

        joinMessCode =
            (joinInput ? joinInput.value : "")
            .trim()
            .toUpperCase();

        if (!joinMessCode) {
            alert("Please enter a Mess Code.");
            return;
        }

        try {

            const messCheckDoc =
                await db.collection("messes")
                .doc(joinMessCode)
                .get();

            if (!messCheckDoc.exists) {
                alert("Mess Code not found.");
                return;
            }

        } catch (checkErr) {

            console.error(
                "Mess code validation failed:",
                checkErr
            );

            alert(
                "Could not verify the Mess Code right now. Please try again."
            );

            return;
        }
    }


    try {

        /*
         * Firebase Authentication account
         */

        const userCredential =
            await auth.createUserWithEmailAndPassword(
                email,
                password
            );


        const firebaseUser =
            userCredential.user;

        let messCode;

        if (messMode === "join") {

            /*
             * JOIN EXISTING MESS
             */

            messCode = joinMessCode;

            state.messCode = messCode;

            localStorage.setItem("messCode", messCode);

            console.log("JOINED MESS CODE:", messCode);

            /*
               Pull the existing mess's shared data into local state
               (per spec section 3) BEFORE adding this user, so we
               don't overwrite anything that's already there.
            */

            const messDoc =
                await db.collection("messes")
                .doc(messCode)
                .get();

            const messData =
                messDoc.exists ? messDoc.data() : {};

            if (Array.isArray(messData.members)) {
                state.members = messData.members;
            }

            if (messData.manager !== undefined) {
                state.manager = messData.manager;
            }

            if (messData.managerPhone !== undefined) {
                state.managerPhone = messData.managerPhone;
            }

            if (
                messData.meals &&
                typeof messData.meals === "object"
            ) {
                state.meals = messData.meals;
            }

            if (Array.isArray(messData.entries)) {
                state.entries = messData.entries;
            }

            if (Array.isArray(messData.history)) {
                state.history = messData.history;
            }

            if (Array.isArray(messData.notices)) {
                state.notices = messData.notices;
            }

            if (messData.mealTimes) {
                state.mealTimes = messData.mealTimes;
            }

            if (messData.menu && typeof messData.menu === "object") {
                state.menu = {
                    meal1: Array.isArray(messData.menu.meal1) ? messData.menu.meal1 : [],
                    meal2: Array.isArray(messData.menu.meal2) ? messData.menu.meal2 : []
                };
            }

            if (Array.isArray(messData.menuOptions)) {
                state.menuOptions = Array.from(new Set(DEFAULT_MENU_OPTIONS.concat(messData.menuOptions).filter(Boolean)));
            }

            if (messData.privacy !== undefined) {
                state.privacy = messData.privacy;
            }

            if (
                messData.memberPhones &&
                typeof messData.memberPhones === "object"
            ) {
                state.memberPhones = messData.memberPhones;
            }

            state.managerPin = null;
            state.managerUnlocked = false;

        } else {

            /*
             * CREATE NEW MESS
             */

            resetLocalMessState();

            messCode =
                "MESS-" +
                Math.random()
                .toString(36)
                .substring(2, 8)
                .toUpperCase();

            state.messCode = messCode;

            localStorage.setItem("messCode", messCode);

            console.log("NEW MESS CODE:", messCode);

            /*
             * This user is the Manager of the new mess.
             */

            state.manager = name;

            state.managerRole = true;

            state.managerUnlocked = false;
        }


        /*
         * User data
         */

        state.user = {

            uid: firebaseUser.uid,

            name: name,

            phone: phone,

            email: email,

            birthday: birthday,

            photo: null

        };


        /*
         * Add user to members (both modes)
         */

        if (!state.members.includes(name)) {

            state.members.unshift(name);

        }

        state.memberPhones[name] = phone;

        state.managerRole =
            state.manager === name;


        /*
         * Save locally for now
         */

        save();


        if (messMode === "create") {

            /*
               Explicitly create the mess document right away
               (rather than waiting for the next save()), so it's
               guaranteed to exist immediately for anyone trying to
               join with this Mess Code.
            */

            await db.collection("messes")
                .doc(messCode)
                .set({
                    messCode: messCode,
                    manager: state.manager,
                    managerPhone: state.managerPhone,
                    managerRole: true,
                    members: state.members,
                    memberPhones: state.memberPhones,
                    meals: state.meals,
                    entries: state.entries,
                    history: state.history,
                    notices: state.notices,
                    menu: state.menu,
                    menuOptions: state.menuOptions,
                    mealTimes: state.mealTimes,
                    privacy: state.privacy,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, {
                    merge: true
                });
        }


        /*
         * Save user to Firestore
         * IMPORTANT: messCode must be stored on the user's own profile doc,
         * otherwise logging in on another device/browser (or after clearing
         * localStorage) has no way to find the mess again, and save()
         * will keep printing "Firebase save skipped: mess code not found".
         */

        await db
            .collection("users")
            .doc(firebaseUser.uid)
            .set({

                uid: firebaseUser.uid,

                name: name,

                phone: phone,

                email: email,

                birthday: birthday,

                photo: null,

                messCode: messCode,

                createdAt: firebase.firestore.FieldValue.serverTimestamp()

            });


        log(
            messMode === "join" ?
            name + " joined the mess (" + messCode + ")" :
            "Created new mess (" + messCode + ") — Manager: " + name
        );


        save();


        /*
         * Open application
         */

        openApp();


    } catch (error) {

        console.error(
            "Firebase account creation error:",
            error
        );


        if (error.code === "auth/email-already-in-use") {

            alert(
                "This Gmail address is already registered."
            );

        } else if (error.code === "auth/invalid-email") {

            alert(
                "Invalid Gmail address."
            );

        } else if (error.code === "auth/weak-password") {

            alert(
                "Password must be at least 6 characters."
            );

        } else {

            alert(
                "Account creation failed: " +
                error.message
            );

        }

    }
}
/* =========================================================
   VERIFICATION
========================================================= */

async function startVerification() {
    const name = document.getElementById("createName").value.trim();
    const phone = document.getElementById("createPhone").value.trim();
    const email = document.getElementById("createEmail").value.trim();
    const birthday = document.getElementById("createBirthday").value;
    const password = document.getElementById("createPassword").value;
    const confirm = document.getElementById("createConfirm").value;

    if (!name || !phone || !email || !birthday || !password || !confirm) {
        alert("Please complete all required fields.");
        return;
    }

    if (!/^[^\s@]+@gmail\.com$/i.test(email)) {
        alert("Please enter a valid Gmail address.");
        return;
    }

    if (password.length < 6) {
        alert("Password must be at least 6 characters.");
        return;
    }

    if (password !== confirm) {
        alert("Passwords do not match.");
        return;
    }

    /*
       JOIN MODE: check the Mess Code up front too, so the person
       doesn't go through emailing themselves a verification code
       only to be rejected at the last step. createAccount() still
       re-checks this before creating anything, since this box could
       have been open a while and the code's validity can't be fully
       trusted by the time they actually submit.
    */
    if (messMode === "join") {

        const joinInput =
            document.getElementById("joinMessCode");

        const code =
            (joinInput ? joinInput.value : "")
            .trim()
            .toUpperCase();

        if (!code) {
            alert("Please enter a Mess Code.");
            return;
        }

        try {

            const messCheckDoc =
                await db.collection("messes")
                .doc(code)
                .get();

            if (!messCheckDoc.exists) {
                alert("Mess Code not found.");
                return;
            }

        } catch (err) {

            console.error(
                "Mess code validation failed:",
                err
            );

            alert(
                "Could not verify the Mess Code right now. Please try again."
            );

            return;
        }
    }

    pendingVerificationCode =
        String(Math.floor(100000 + Math.random() * 900000));

    const sendBtn = document.querySelector(
        '.auth-main-btn[onclick="startVerification()"]'
    );

    const notConfigured = !EMAILJS_SERVICE_ID ||
        !EMAILJS_TEMPLATE_ID ||
        !EMAILJS_PUBLIC_KEY;

    if (notConfigured || typeof emailjs === "undefined") {
        document
            .getElementById("verificationBox")
            .classList.remove("hidden");

        document.getElementById("verificationHint").textContent =
            "EmailJS not configured yet. Demo code: " +
            pendingVerificationCode;

        document.getElementById("verificationCode").focus();

        return;
    }

    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.textContent = "Sending code...";
    }

    emailjs.send(
            EMAILJS_SERVICE_ID,
            EMAILJS_TEMPLATE_ID, {
                to_name: name,
                to_email: email,
                code: pendingVerificationCode
            }
        )
        .then(function() {
            document
                .getElementById("verificationBox")
                .classList.remove("hidden");

            document.getElementById("verificationHint").textContent =
                "A code was sent to " +
                email +
                ". Check your inbox and spam folder.";

            document.getElementById("verificationCode").focus();
        })
        .catch(function(err) {
            console.error("EmailJS error:", err);

            alert(
                "Could not send the email right now. Showing the code here instead."
            );

            document
                .getElementById("verificationBox")
                .classList.remove("hidden");

            document.getElementById("verificationHint").textContent =
                "Send failed, fallback code: " +
                pendingVerificationCode;

            document.getElementById("verificationCode").focus();
        })
        .finally(function() {
            if (sendBtn) {
                sendBtn.disabled = false;
                sendBtn.textContent = "Send Verification Code";
            }
        });
}

function verifyAndCreate() {
    const enteredCode =
        document.getElementById("verificationCode").value.trim();

    if (enteredCode !== pendingVerificationCode) {
        alert("Incorrect verification code.");
        return;
    }

    createAccount();

    pendingVerificationCode = null;
}

/* =========================================================
   PASSWORD RESET
========================================================= */

async function forgotPassword() {
    const identity =
        document
        .getElementById("loginIdentity")
        .value
        .trim();

    if (!identity) {
        alert("Please enter your Gmail or phone number first.");
        return;
    }

    if (!auth) {
        alert("Firebase Authentication is not available.");
        return;
    }

    try {
        let email = identity;

        if (!identity.includes("@")) {
            const snapshot =
                await db
                .collection("users")
                .where("phone", "==", identity)
                .limit(1)
                .get();

            if (snapshot.empty) {
                alert("No account found with this phone number.");
                return;
            }

            email = snapshot.docs[0].data().email;
        }

        if (!email || !email.includes("@")) {
            alert("Please enter a valid Gmail address or phone number.");
            return;
        }

        await auth.sendPasswordResetEmail(email);

        alert(
            "Password reset email sent to " +
            email +
            ". Please check your inbox and spam folder."
        );

    } catch (error) {
        console.error("Password reset error:", error);

        if (error.code === "auth/user-not-found") {
            alert("No account found for this Gmail address.");
        } else if (error.code === "auth/invalid-email") {
            alert("Please enter a valid Gmail address.");
        } else {
            alert(
                "Could not send the reset email: " +
                error.message
            );
        }
    }
}

/* =========================================================
   LOGIN - FIREBASE
========================================================= */

async function login() {

    const identity =
        document
        .getElementById("loginIdentity")
        .value
        .trim();

    const password =
        document
        .getElementById("loginPassword")
        .value;


    if (!identity || !password) {

        alert(
            "Please enter your Gmail and password."
        );

        return;
    }


    if (!auth) {

        alert(
            "Firebase Authentication is not available."
        );

        return;
    }


    /*
     * Firebase Email/Password login
     */

    try {

        let email = identity;


        /*
         * Firebase login uses email.
         */

        if (!identity.includes("@")) {

            /*
             * If user enters phone number,
             * find the matching user in Firestore.
             */

            const snapshot =
                await db
                .collection("users")
                .where(
                    "phone",
                    "==",
                    identity
                )
                .limit(1)
                .get();


            if (snapshot.empty) {

                alert(
                    "No account found with this phone number."
                );

                return;
            }


            email =
                snapshot.docs[0].data().email;

        }


        const userCredential =
            await auth.signInWithEmailAndPassword(
                email,
                password
            );


        const firebaseUser =
            userCredential.user;


        /*
         * Load user data from Firestore
         */

        const userDoc =
            await db
            .collection("users")
            .doc(firebaseUser.uid)
            .get();


        if (!userDoc.exists) {

            alert(
                "User profile not found."
            );

            return;
        }


        const userData =
            userDoc.data();


        /*
         * Restore mess code
         * This is the key fix: without this, state.messCode and
         * localStorage's "messCode" stay empty on a fresh browser/device,
         * and every future save() call silently skips the Firebase write
         * with "Firebase save skipped: mess code not found".
         */

        if (userData.messCode) {

            state.messCode = userData.messCode;

            localStorage.setItem(
                "messCode",
                userData.messCode
            );

            console.log(
                "Restored mess code from Firestore:",
                userData.messCode
            );

        } else if (state.messCode) {

            /*
               Backward compatibility: this user account was created
               before messCode was stored on the user doc. If this
               browser still happens to have a messCode locally
               (e.g. same device that created the account), push it
               up to Firestore now so future logins elsewhere work too.
            */

            await db
                .collection("users")
                .doc(firebaseUser.uid)
                .set({
                    messCode: state.messCode
                }, {
                    merge: true
                });

            localStorage.setItem(
                "messCode",
                state.messCode
            );

            console.log(
                "Backfilled missing messCode to Firestore:",
                state.messCode
            );

        } else {

            alert(
                "This account isn't linked to any mess yet. " +
                "Please contact support or create a new mess."
            );

            return;
        }


        /*
         * Restore user state
         */

        state.user = {

            uid: firebaseUser.uid,

            name: userData.name || "",

            phone: userData.phone || "",

            email: userData.email || "",

            birthday: userData.birthday || "",

            photo: userData.photo || null

        };


        /*
         * IMPORTANT: load the full mess document (members, meals,
         * entries, history, notices, manager info, meal times, etc.)
         * from Firebase now that we know the mess code. Without this,
         * only this user's own profile fields come back on login —
         * the rest of the mess's shared data stays stuck at whatever
         * was last in localStorage.
         */

        await loadMessData();


        /*
         * Restore member information
         */

        if (!state.members.includes(
                state.user.name
            )) {

            state.members.unshift(
                state.user.name
            );

        }


        state.memberPhones[
                state.user.name
            ] =
            state.user.phone;


        save();


        openApp();


    } catch (error) {

        console.error(
            "Firebase login error:",
            error
        );


        if (
            error.code ===
            "auth/invalid-credential"
        ) {

            alert(
                "Incorrect Gmail/phone or password."
            );

        } else if (
            error.code ===
            "auth/user-not-found"
        ) {

            alert(
                "No account found."
            );

        } else if (
            error.code ===
            "auth/wrong-password"
        ) {

            alert(
                "Incorrect password."
            );

        } else {

            alert(
                "Login failed: " +
                error.message
            );

        }

    }
}


/* =========================================================
   DEMO MODE (FOR PUBLIC GITHUB PREVIEW / SAFE TESTING)
========================================================= */

let isDemoMode = false;

function startDemoMode() {
    isDemoMode = true;

    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    const demoState = {
        isDemoMode: true,
        messCode: "DEMO-2026",
        manager: "সাকিব (Manager)",
        managerPhone: "01711-223344",
        managerRole: true,
        managerUnlocked: true,
        managerPin: "1234",
        language: "bn",
        privacy: "private",
        mealTimes: { meal1: "13:00", meal2: "21:00" },
        menu: {
            meal1: ["ভাত", "মুরগির মাংস", "ডাল"],
            meal2: ["ভাত", "রুই মাছ", "সবজি"]
        },
        menuOptions: ["ভাত", "মাছ", "ডাল", "ডিম", "মুরগি", "গরুর মাংস", "সবজি"],
        members: ["সাকিব (Manager)", "তানভীর আহমেদ", "রাকিব হাসান", "সাজিদুর রহমান"],
        memberPhones: {
            "সাকিব (Manager)": "01711-223344",
            "তানভীর আহমেদ": "01822-334455",
            "রাকিব হাসান": "01933-445566",
            "সাজিদুর রহমান": "01644-556677"
        },
        user: {
            uid: "demo-guest-uid",
            name: "সাকিব (Manager)",
            phone: "01711-223344",
            email: "demo.guest@hisab.app",
            birthday: "2000-01-01",
            photo: null
        },
        meals: {},
        entries: [
            { id: "e1", type: "income", member: "সাকিব (Manager)", amount: 3000, text: "মাসিক মেস জমা", date: yesterday, ts: Date.now() - 86400000 * 2 },
            { id: "e2", type: "income", member: "তানভীর আহমেদ", amount: 3000, text: "মাসিক মেস জমা", date: yesterday, ts: Date.now() - 86400000 * 2 },
            { id: "e3", type: "income", member: "রাকিব হাসান", amount: 3000, text: "মাসিক মেস জমা", date: yesterday, ts: Date.now() - 86400000 * 2 },
            { id: "e4", type: "income", member: "সাজিদুর রহমান", amount: 3000, text: "মাসিক মেস জমা", date: yesterday, ts: Date.now() - 86400000 * 2 },
            { id: "e5", type: "expense", member: "সাকিব (Manager)", amount: 2450, text: "সাপ্তাহিক বড় বাজার (মুরগি, চাল, তেল, মসলা)", date: yesterday, ts: Date.now() - 86400000 },
            { id: "e6", type: "expense", member: "রাকিব হাসান", amount: 980, text: "সিলিন্ডার গ্যাস বিল পরিশোধ", date: today, ts: Date.now() - 3600000 * 5 },
            { id: "e7", type: "expense", member: "তানভীর আহমেদ", amount: 650, text: "শাক-সবজি ও তাজা মাছ বাজার", date: today, ts: Date.now() - 3600000 * 2 }
        ],
        history: [
            { id: "h1", text: "সাকিব (Manager) সাপ্তাহিক বড় বাজার এন্ট্রি করেছেন (৳2450)", date: yesterday, ts: Date.now() - 86400000 },
            { id: "h2", text: "রাকিব হাসান গ্যাস বিল পরিশোধ করেছেন (৳980)", date: today, ts: Date.now() - 3600000 * 5 },
            { id: "h3", text: "তানভীর আহমেদ তাজা মাছ ও সবজি বাজার করেছেন (৳650)", date: today, ts: Date.now() - 3600000 * 2 }
        ],
        notices: [
            { id: "n1", text: "স্বাগতম হিসাব ডেমো মোডে! এখানে আপনি মিল অন/অফ, এন্ট্রি যোগ এবং চার্ট অ্যানালিটিক্স সম্পূর্ণ ফ্রিলি পরীক্ষা করতে পারবেন।", date: today, ts: Date.now() }
        ]
    };

    demoState.meals[today] = {
        "সাকিব (Manager)": { meal1: 1, meal2: 1, guest: 0 },
        "তানভীর আহমেদ": { meal1: 1, meal2: 1, guest: 0 },
        "রাকিব হাসান": { meal1: 0, meal2: 1, guest: 0 },
        "সাজিদুর রহমান": { meal1: 1, meal2: 0, guest: 1 }
    };
    demoState.meals[yesterday] = {
        "সাকিব (Manager)": { meal1: 1, meal2: 1, guest: 0 },
        "তানভীর আহমেদ": { meal1: 1, meal2: 1, guest: 0 },
        "রাকিব হাসান": { meal1: 1, meal2: 1, guest: 0 },
        "সাজিদুর রহমান": { meal1: 1, meal2: 1, guest: 0 }
    };

    state = demoState;

    const banner = document.getElementById("demoBanner");
    if (banner) {
        banner.classList.remove("hidden");
    }

    openApp();
}

function exitDemoMode() {
    isDemoMode = false;
    const banner = document.getElementById("demoBanner");
    if (banner) {
        banner.classList.add("hidden");
    }

    state = JSON.parse(localStorage.getItem(KEY) || "null") || {
        messCode: "",
        user: null,
        verification: null,
        manager: "Not set",
        managerPhone: "",
        members: ["Member 1", "Member 2", "Member 3"],
        managerRole: false,
        managerPin: null,
        managerUnlocked: false,
        menu: { meal1: [], meal2: [] },
        menuOptions: ["ভাত", "মাছ", "ডাল", "ডিম", "মুরগি"],
        meals: {},
        entries: [],
        history: [],
        notices: [],
        language: "en",
        mealTimes: { meal1: "10:00", meal2: "20:00" },
        privacy: "private",
        memberPhones: {}
    };

    logout();
}

/* =========================================================
   APP
========================================================= */

function openApp() {
    document.getElementById("authScreen").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");

    const messCode = state.messCode || localStorage.getItem("messCode");
    if (messCode) {
        startMessRealtimeListener(messCode);
    }

    updateSidebarCurrentWidth();
    applyLanguage();
    renderAll();
}

document.addEventListener("click", function (event) {
    const sidebar = document.getElementById("appSidebar");

    if (!sidebar || !sidebar.contains(event.target)) {
        return;
    }

    if (event.target.closest("button") || event.target.closest("input") || event.target.closest("select") || event.target.closest("label")) {
        return;
    }

    toggleSidebar();
});

window.addEventListener("resize", updateSidebarCurrentWidth);

function logout() {
    closeModal("profileModal");

    if (messListenerUnsubscribe) {
        messListenerUnsubscribe();
        messListenerUnsubscribe = null;
    }

    if (auth && typeof auth.signOut === "function") {
        auth.signOut().catch(function(err) {
            console.error("Sign out failed:", err);
        });
    }

    state.user = null;

    localStorage.setItem(KEY, JSON.stringify(state));

    document.getElementById("app").classList.add("hidden");
    document.getElementById("authScreen").classList.remove("hidden");

    showLogin();
}

function tab(id, btn) {
    document
        .querySelectorAll(".page")
        .forEach(function(x) {
            x.classList.remove("active");
        });

    const page = document.getElementById(id);

    if (page) {
        page.classList.add("active");
    }

    document
        .querySelectorAll(".sidebar-nav li")
        .forEach(function(item) {
            item.classList.remove("active");
        });

    const activeButton = btn || document.querySelector(
        '.sidebar-nav button[onclick*="tab(\'' + id + '\'"]'
    );

    if (activeButton) {
        const activeItem = activeButton.closest("li");
        if (activeItem) {
            activeItem.classList.add("active");
        }
    }

    renderAll();
}


/* =========================================================
   PROFILE
========================================================= */

function openProfile() {
    if (!state.user) {
        showCreate();
        return;
    }

    document.getElementById("profileName").value =
        state.user.name || "";

    document.getElementById("profileNumber").value =
        state.user.phone || "";

    document.getElementById("profileEmail").value =
        state.user.email || "";

    document.getElementById("profileBirthday").value =
        state.user.birthday || "";

    document.getElementById("profileDisplayName").textContent =
        state.user.name;

    renderProfilePhoto();

    document.getElementById("profileModal").classList.add("open");
}

function saveProfile() {
    if (!state.user) return;

    const oldName = state.user.name;

    const name =
        document.getElementById("profileName").value.trim();

    const phone =
        document.getElementById("profileNumber").value.trim();

    const email =
        document.getElementById("profileEmail").value.trim();

    const birthday =
        document.getElementById("profileBirthday").value;

    if (!name || !phone) {
        alert("Name and number are required.");
        return;
    }

    state.user.name = name;
    state.user.phone = phone;
    state.user.email = email;
    state.user.birthday = birthday;

    if (state.members.includes(oldName)) {
        state.members = state.members.map(function(m) {
            return m === oldName ? name : m;
        });
    } else {
        state.members.push(name);
    }

    if (state.memberPhones[oldName] !== undefined) {
        state.memberPhones[name] = phone;

        if (oldName !== name) {
            delete state.memberPhones[oldName];
        }
    } else {
        state.memberPhones[name] = phone;
    }

    if (state.manager === oldName) {
        state.manager = name;
    }

    document.getElementById("profileDisplayName").textContent =
        name;

    log("Profile updated");

    save();

    renderAll();

    alert("Profile saved.");
}

function changePhoto(el) {
    const input =
        el ||
        document.getElementById("sidebarProfilePhotoInput") ||
        document.getElementById("profilePhotoInput");

    if (!input || !input.files || !input.files[0]) {
        return;
    }

    const file = input.files[0];

    const reader = new FileReader();

    reader.onload = function() {
        state.user.photo = reader.result;

        save();

        renderProfilePhoto();
        renderSidebarProfile();
        renderAll();
    };

    reader.readAsDataURL(file);
}

function renderProfilePhoto() {
    const box =
        document.getElementById("profilePhoto");

    if (!box) return;

    if (state.user && state.user.photo) {
        box.innerHTML =
            `<img src="${state.user.photo}" alt="Profile">`;
    } else {
        box.textContent =
            initials(state.user && state.user.name);
    }
}


/* =========================================================
   MODALS
========================================================= */

function closeModal(id) {
    const el = document.getElementById(id);

    if (el) {
        el.classList.remove("open");
    }
}


/* =========================================================
   NOTICE
========================================================= */

function openNotice() {
    renderNotices();

    document
        .getElementById("noticeModal")
        .classList.add("open");
}

function renderNotices() {
    const el =
        document.getElementById("noticeList");

    if (!el) return;

    if (!state.notices.length) {
        el.innerHTML =
            '<p class="locked">No notices.</p>';

        return;
    }

    el.innerHTML = state.notices
        .map(function(n) {
            return `
                <div class="notice">
                    <b>${escapeHtml(n.text)}</b>
                    <br>
                    <small>${escapeHtml(n.date)}</small>
                </div>
            `;
        })
        .join("");
}


/* =========================================================
   MEALS
========================================================= */

function ensureMealData() {
    const key = todayKey();

    if (!state.meals[key] ||
        typeof state.meals[key] !== "object" ||
        Array.isArray(state.meals[key])
    ) {
        state.meals[key] = {};
    }

    /*
       Old data migration
    */

    if (
        state.user &&
        (
            state.meals[key].meal1 !== undefined ||
            state.meals[key].meal2 !== undefined
        )
    ) {
        state.meals[key][state.user.name] = {
            meal1: state.meals[key].meal1 ? 1 : 0,
            meal2: state.meals[key].meal2 ? 1 : 0,
            guest: 0
        };

        delete state.meals[key].meal1;
        delete state.meals[key].meal2;
    }

    (state.members || []).forEach(function(name) {
        if (!state.meals[key][name]) {
            state.meals[key][name] = {
                meal1: 0,
                meal2: 0,
                guest: 0
            };
        }

        const member = state.meals[key][name];

        member.meal1 =
            Number(member.meal1) || 0;

        member.meal2 =
            Number(member.meal2) || 0;

        member.guest =
            Number(member.guest) || 0;
    });

    return state.meals[key];
}

function isPastMealCutoff(mealNo) {
    const cutoff =
        mealNo === 1 ?
        state.mealTimes.meal1 :
        state.mealTimes.meal2;

    if (!cutoff) return false;

    const now = new Date();

    const nowStr =
        String(now.getHours()).padStart(2, "0") +
        ":" +
        String(now.getMinutes()).padStart(2, "0");

    return nowStr > cutoff;
}

function toggleOwnMeal(name, mealNo) {
    if (!state.user) return;

    if (state.user.name !== name) {
        alert("আপনি শুধু নিজের মিল অন/অফ করতে পারবেন।");
        return;
    }

    if (isPastMealCutoff(mealNo)) {
        const cutoff =
            mealNo === 1 ?
            state.mealTimes.meal1 :
            state.mealTimes.meal2;

        alert(
            "Meal " +
            mealNo +
            " এর সময়সীমা (" +
            cutoff +
            ") পার হয়ে গেছে। Manager-কে জানান।"
        );

        return;
    }

    const data = ensureMealData();

    if (!data[name]) {
        data[name] = {
            meal1: 0,
            meal2: 0,
            guest: 0
        };
    }

    const field =
        mealNo === 1 ?
        "meal1" :
        "meal2";

    data[name][field] =
        data[name][field] > 0 ?
        0 :
        1;

    log(
        name +
        " turned " +
        (data[name][field] ? "ON " : "OFF ") +
        "Meal " +
        mealNo
    );

    save();

    renderMeals();
}

function setGuestMeal(name) {
    if (!state.user) return;

    if (state.user.name !== name) {
        alert(
            "আপনি শুধু নিজের জন্য Guest Meal যোগ করতে পারবেন।"
        );

        return;
    }

    const data = ensureMealData();

    if (!data[name]) {
        data[name] = {
            meal1: 0,
            meal2: 0,
            guest: 0
        };
    }

    const val = prompt(
        "আজকে কতগুলো Guest Meal যোগ করতে চান? (0 লিখলে বন্ধ হয়ে যাবে)",
        String(data[name].guest || 0)
    );

    if (val === null) return;

    const num = Number(val);

    if (isNaN(num) || num < 0) {
        alert("সঠিক সংখ্যা দিন (0 বা তার বেশি)।");
        return;
    }

    data[name].guest = num;

    log(
        name +
        " set Guest Meal to " +
        num
    );

    save();

    renderMeals();
}


/* =========================================================
   MEAL TIME
========================================================= */

function saveMealTimes() {
    if (!requireManager() || !state.managerUnlocked) {
        alert(
            "শুধু PIN দিয়ে Unlock করা Manager সময়সীমা সেট করতে পারবে।"
        );

        return;
    }

    const t1 =
        document.getElementById("meal1CutoffInput").value;

    const t2 =
        document.getElementById("meal2CutoffInput").value;

    if (!t1 || !t2) {
        alert("দুইটা সময়ই দিন।");
        return;
    }

    state.mealTimes = {
        meal1: t1,
        meal2: t2
    };

    log(
        "Manager set meal cutoff times: Meal1=" +
        t1 +
        ", Meal2=" +
        t2
    );

    save();

    alert("মিল বন্ধ করার সময় সেভ হয়েছে।");
}


/* =========================================================
   MANAGER MEAL EDIT
========================================================= */

function managerEditMeal(name) {
    if (!requireManager() || !state.managerUnlocked) {
        alert(
            "শুধু PIN দিয়ে Unlock করা Manager মিল সরাসরি এডিট করতে পারবে।"
        );

        return;
    }

    const data = ensureMealData();

    if (!data[name]) {
        data[name] = {
            meal1: 0,
            meal2: 0,
            guest: 0
        };
    }

    const cur = data[name];

    const m1 = prompt(
        name +
        " - Meal 1 koto? (0, 0.5, 1, 2)",
        String(cur.meal1 || 0)
    );

    if (m1 === null) return;

    const m2 = prompt(
        name +
        " - Meal 2 koto? (0, 0.5, 1, 2)",
        String(cur.meal2 || 0)
    );

    if (m2 === null) return;

    const g = prompt(
        name +
        " - Guest Meal koto?",
        String(cur.guest || 0)
    );

    if (g === null) return;

    const v1 = Number(m1);
    const v2 = Number(m2);
    const vg = Number(g);

    if (
        isNaN(v1) ||
        isNaN(v2) ||
        isNaN(vg) ||
        v1 < 0 ||
        v2 < 0 ||
        vg < 0
    ) {
        alert("সঠিক সংখ্যা দিন (0 বা তার বেশি)।");
        return;
    }

    data[name] = {
        meal1: v1,
        meal2: v2,
        guest: vg
    };

    log(
        "Manager set " +
        name +
        "'s meals: Meal1=" +
        v1 +
        ", Meal2=" +
        v2 +
        ", Guest=" +
        vg
    );

    save();

    renderMeals();
    renderManagerPanel();
    renderMealEditPage();
}


/* =========================================================
   MEAL RATE
========================================================= */

function computeMealRate() {
    const totalExpense =
        state.entries
        .filter(function(e) {
            return e.type === "expense";
        })
        .reduce(function(a, b) {
            return a + Number(b.amount || 0);
        }, 0);

    const members =
        state.members || [];

    const totalMealsAll =
        members.reduce(function(a, name) {
            return a + totalMealsForMember(name);
        }, 0);

    return totalMealsAll > 0 ?
        totalExpense / totalMealsAll :
        0;
}


/* =========================================================
   RENDER MEALS
========================================================= */

function renderMeals() {
    const data = ensureMealData();

    const members =
        state.members || [];

    const list =
        document.getElementById("mealMemberList");

    const canManagerEdit =
        isManager() &&
        state.managerUnlocked;

    let meal1Count = 0;
    let meal2Count = 0;
    let total = 0;

    members.forEach(function(name) {
        const m =
            data[name] || {
                meal1: 0,
                meal2: 0,
                guest: 0
            };

        meal1Count += Number(m.meal1) || 0;
        meal2Count += Number(m.meal2) || 0;

        total +=
            (Number(m.meal1) || 0) +
            (Number(m.meal2) || 0) +
            (Number(m.guest) || 0);
    });

    if (list) {
        list.innerHTML = members.length ?
            members.map(function(name) {

                const m =
                    data[name] || {
                        meal1: 0,
                        meal2: 0,
                        guest: 0
                    };

                const count =
                    (Number(m.meal1) || 0) +
                    (Number(m.meal2) || 0) +
                    (Number(m.guest) || 0);

                const isSelf =
                    state.user &&
                    state.user.name === name;

                let buttonsHtml = "";

                if (canManagerEdit) {

                    buttonsHtml = `
                        <button
                            class="btn btn-light"
                            style="width:auto;margin:0;padding:8px 12px"
                            onclick="openMealEditPage()">
                            ✎ Edit Meals
                        </button>
                    `;

                } else if (isSelf) {

                    buttonsHtml = `
                        <button
                            class="meal-person-btn ${m.meal1 > 0 ? "active" : ""}"
                            onclick="toggleOwnMeal('${escapeJs(name)}',1)">
                            🌅 Meal 1 ${m.meal1 > 0 ? "✓" : "+"}
                        </button>

                        <button
                            class="meal-person-btn ${m.meal2 > 0 ? "active" : ""}"
                            onclick="toggleOwnMeal('${escapeJs(name)}',2)">
                            🌙 Meal 2 ${m.meal2 > 0 ? "✓" : "+"}
                        </button>

                        <button
                            class="meal-person-btn ${m.guest > 0 ? "active" : ""}"
                            onclick="setGuestMeal('${escapeJs(name)}')">
                            🎉 Guest: ${m.guest || 0}
                        </button>
                    `;

                } else {

                    buttonsHtml = `
                        <span class="locked" style="font-size:12px">
                            শুধু ${escapeHtml(name)} বা Manager এডিট করতে পারবে
                        </span>
                    `;
                }

                return `
                    <div class="meal-member">

                        <div class="meal-member-info">

                            <div class="avatar">
                                ${initials(name)}
                            </div>

                            <div>
                                <div class="meal-member-name">
                                    ${escapeHtml(name)}
                                </div>

                                <span class="meal-count-badge">
                                    ${count} meals today
                                    ${m.guest > 0 ? "(guest সহ)" : ""}
                                </span>
                            </div>

                        </div>

                        <div class="meal-member-buttons">
                            ${buttonsHtml}
                        </div>

                    </div>
                `;

            }).join("") :
            '<p class="locked">No members added yet.</p>';
    }

    const e1 =
        document.getElementById("meal1PeopleCount");

    const e2 =
        document.getElementById("meal2PeopleCount");

    const et =
        document.getElementById("totalMealPeople");

    const top =
        document.getElementById("mealCount");

    const rateEl =
        document.getElementById("mealRateDisplay");

    if (e1) {
        e1.textContent = meal1Count;
    }

    if (e2) {
        e2.textContent = meal2Count;
    }

    if (et) {
        et.textContent = total;
    }

    if (top) {
        top.textContent =
            meal1Count + meal2Count;
    }

    if (rateEl) {
        rateEl.textContent =
            "৳" +
            computeMealRate().toFixed(2);
    }
}


/* =========================================================
   ACCOUNT ENTRY
========================================================= */

let currentEntryType = "expense";

function openEntryPage() {
    if (!requireManager() || !state.managerUnlocked) {
        alert(
            "শুধু PIN দিয়ে Unlock করা Manager হিসাব এন্ট্রি যোগ করতে পারবে।"
        );

        return;
    }

    document
        .querySelectorAll(".page")
        .forEach(function(x) {
            x.classList.remove("active");
        });

    document
        .getElementById("entryPage")
        .classList.add("active");

    document.getElementById("entryDesc").value = "";
    document.getElementById("entryAmount").value = "";

    setEntryType("expense");
}

function closeEntryPage() {
    document
        .getElementById("entryPage")
        .classList.remove("active");

    document
        .querySelectorAll(".page")
        .forEach(function(x) {
            x.classList.remove("active");
        });

    document
        .getElementById("accounts")
        .classList.add("active");

    document
        .querySelectorAll(".tabs button")[2] && document.querySelectorAll(".tabs button")[2]
        .classList.add("active");

}

function setEntryType(type) {
    currentEntryType = type;

    const incomeBtn =
        document.getElementById("entryTypeIncomeBtn");

    const expenseBtn =
        document.getElementById("entryTypeExpenseBtn");

    if (incomeBtn) {
        incomeBtn.classList.toggle(
            "active",
            type === "income"
        );
    }

    if (expenseBtn) {
        expenseBtn.classList.toggle(
            "active",
            type === "expense"
        );
    }

    const memberField =
        document.getElementById("entryMemberField");

    const memberSelect =
        document.getElementById("entryMemberSelect");

    if (!memberField || !memberSelect) return;

    if (type === "income") {

        memberField.classList.remove("hidden");

        const members =
            state.members || [];

        memberSelect.innerHTML =
            members.map(function(m) {
                return `
                    <option value="${escapeHtml(m)}">
                        ${escapeHtml(m)}
                    </option>
                `;
            }).join("");

    } else {

        memberField.classList.add("hidden");
    }
}

function saveEntryFromPage() {
    const desc =
        document.getElementById("entryDesc")
        .value.trim();

    const amount =
        Number(
            document.getElementById("entryAmount")
            .value
        );

    if (!desc) {
        alert("বিবরণ লিখুন।");
        return;
    }

    if (!amount || amount <= 0) {
        alert("সঠিক টাকার পরিমাণ দিন।");
        return;
    }

    let member = null;

    if (currentEntryType === "income") {
        member =
            document.getElementById("entryMemberSelect")
            .value || null;
    }

    state.entries.push({
        id: generateId(),
        ts: Date.now(),
        desc: desc,
        amount: amount,
        type: currentEntryType,
        date: today(),
        member: member
    });

    log(
        "Added " +
        currentEntryType +
        ": " +
        desc +
        (member ? " (" + member + ")" : "")
    );

    save();

    renderAll();

    closeEntryPage();

    alert("এন্ট্রি সেভ হয়েছে।");
}


/* =========================================================
   RESET MONTH
========================================================= */

function resetMonthlyData() {
    if (!requireManager() || !state.managerUnlocked) {
        return;
    }

    if (!confirm(
            "আপনি কি নিশ্চিত? এই মাসের সব মিল, এন্ট্রি এবং হিস্টোরি সম্পূর্ণভাবে মুছে যাবে। এই কাজ ফেরানো যাবে না।"
        )) {
        return;
    }

    if (!confirm(
            "শেষবার নিশ্চিত করুন: সব হিসাব ডিলিট করতে চান?"
        )) {
        return;
    }

    state.meals = {};
    state.entries = [];
    state.history = [];

    log(
        "Manager reset all monthly data"
    );

    save();

    renderAll();

    alert(
        "এই মাসের সব হিসাব মুছে ফেলা হয়েছে।"
    );
}


/* =========================================================
   PDF REPORT
========================================================= */

function downloadPdfReport() {
    if (!state.user) {
        alert("আগে লগইন করুন।");
        return;
    }

    const name = state.user.name;
    const photo = state.user.photo;

    const managerName =
        state.manager || "Not set";

    const deposit =
        state.entries
        .filter(function(e) {
            return (
                e.type === "income" &&
                e.member === name
            );
        })
        .reduce(function(a, b) {
            return a + Number(b.amount || 0);
        }, 0);

    const rate =
        computeMealRate();

    const myMeals =
        totalMealsForMember(name);

    const totalMealsAll =
        (state.members || [])
        .reduce(function(a, n) {
            return a + totalMealsForMember(n);
        }, 0);

    const mealCost =
        myMeals * rate;

    const balance =
        deposit - mealCost;

    const balLabel =
        balance >= 0 ?
        "আপনি পাবেন" :
        "আপনাকে দিতে হবে";

    const balClass =
        balance >= 0 ?
        "income" :
        "expense";

    const todayText =
        new Date().toLocaleDateString("bn-BD");

    const dateKeys =
        Object.keys(state.meals || {})
        .sort();

    const rowsData =
        dateKeys
        .map(function(dateKey) {

            const day =
                state.meals[dateKey];

            if (!day) return null;

            const m =
                day[name];

            if (!m) return null;

            const dayTotal =
                (Number(m.meal1) || 0) +
                (Number(m.meal2) || 0) +
                (Number(m.guest) || 0);

            if (dayTotal <= 0) {
                return null;
            }

            return {
                dateKey: dateKey,
                meal1: Number(m.meal1) || 0,
                meal2: Number(m.meal2) || 0,
                guest: Number(m.guest) || 0,
                dayTotal: dayTotal
            };

        })
        .filter(Boolean);

    const tableRows =
        rowsData.map(function(r) {
            return `
                <tr style="border-bottom:1px solid #f1f5f9">
                    <td style="padding:5px 0">
                        ${escapeHtml(r.dateKey)}
                    </td>

                    <td style="text-align:center">
                        ${r.meal1}
                    </td>

                    <td style="text-align:center">
                        ${r.meal2}
                    </td>

                    <td style="text-align:center">
                        ${r.guest}
                    </td>

                    <td style="text-align:center">
                        <b>${r.dayTotal}</b>
                    </td>
                </tr>
            `;
        }).join("");

    const mealTableHtml =
        rowsData.length ?
        `
                <h3 style="margin:24px 0 8px">
                    তারিখ অনুযায়ী মিল
                </h3>

                <table style="width:100%;border-collapse:collapse;font-size:13px">

                    <thead>
                        <tr style="border-bottom:2px solid #e5e7eb">

                            <th style="text-align:left;padding:6px 0">
                                তারিখ
                            </th>

                            <th style="padding:6px 0">
                                Meal 1
                            </th>

                            <th style="padding:6px 0">
                                Meal 2
                            </th>

                            <th style="padding:6px 0">
                                Guest
                            </th>

                            <th style="padding:6px 0">
                                মোট
                            </th>

                        </tr>
                    </thead>

                    <tbody>
                        ${tableRows}
                    </tbody>

                </table>
            ` :
        `
                <p style="color:#9ca3af;margin-top:20px">
                    এখনো কোনো মিলের তথ্য নেই।
                </p>
            `;

    const report =
        document.getElementById("printReport");

    if (!report) {
        alert("Print report section not found.");
        return;
    }

    report.innerHTML = `
        ${
            photo
                ? `<img class="print-photo" src="${photo}">`
                : `
                    <div
                        class="print-photo"
                        style="
                            display:flex;
                            align-items:center;
                            justify-content:center;
                            background:#f1f5f9;
                            font-weight:800;
                            font-size:24px;
                        ">
                        ${initials(name)}
                    </div>
                `
        }

        <h2 style="text-align:center;margin:0 0 4px">
            ${escapeHtml(name)}
        </h2>

        <p style="text-align:center;color:#6b7280;margin:0 0 20px">
            হিসাব রিপোর্ট • ${todayText}
        </p>

        <div class="print-row">
            <span>এই মাসের ম্যানেজার</span>
            <b>${escapeHtml(managerName)}</b>
        </div>

        <div class="print-row">
            <span>আমার মোট জমা</span>
            <b>৳${deposit.toFixed(2)}</b>
        </div>

        <div class="print-row">
            <span>মিল রেট</span>
            <b>৳${rate.toFixed(2)} / meal</b>
        </div>

        <div class="print-row">
            <span>মেসের মোট মিল হয়েছে</span>
            <b>${totalMealsAll}</b>
        </div>

        <div class="print-row">
            <span>আমার মোট মিল</span>
            <b>${myMeals}</b>
        </div>

        <div class="print-row">
            <span>আমার মিল খরচ</span>
            <b>৳${mealCost.toFixed(2)}</b>
        </div>

        <div
            class="print-row"
            style="border:0;font-size:17px;margin-top:8px">

            <span>
                <b>${balLabel}</b>
            </span>

            <b class="${balClass}">
                ৳${Math.abs(balance).toFixed(2)}
            </b>
        </div>

        ${mealTableHtml}
    `;

    setTimeout(function () {
        window.print();
    }, 100);
}


/* =========================================================
   ACCOUNTS
========================================================= */

function renderAccounts() {
    const inc =
        state.entries
            .filter(function (e) {
                return e.type === "income";
            })
            .reduce(function (a, b) {
                return a + Number(b.amount || 0);
            }, 0);

    const exp =
        state.entries
            .filter(function (e) {
                return e.type === "expense";
            })
            .reduce(function (a, b) {
                return a + Number(b.amount || 0);
            }, 0);

    const incomeEl =
        document.getElementById("income");

    const expenseEl =
        document.getElementById("expense");

    const balanceEl =
        document.getElementById("balance");

    const entriesCountEl =
        document.getElementById("entriesCount");

    const accountCountEl =
        document.getElementById("accountCount");

    if (incomeEl) {
        incomeEl.textContent =
            "৳" + inc.toFixed(2);
    }

    if (expenseEl) {
        expenseEl.textContent =
            "৳" + exp.toFixed(2);
    }

    if (balanceEl) {
        balanceEl.textContent =
            "৳" + (inc - exp).toFixed(2);
    }

    if (entriesCountEl) {
        entriesCountEl.textContent =
            state.entries.length;
    }

    if (accountCountEl) {
        accountCountEl.textContent =
            state.entries.length;
    }

    renderAnalyticsChart(inc, exp);

    const entriesEl =
        document.getElementById("entries");

    if (entriesEl) {

        entriesEl.innerHTML =
            state.entries.length

                ? state.entries
                    .slice()
                    .reverse()
                    .map(function (e) {

                        return `
                            <div class="row">

                                <div>

                                    <b>
                                        ${escapeHtml(e.desc)}
                                    </b>

                                    ${
                                        e.member
                                            ? `
                                                <small class="locked">
                                                    (${escapeHtml(e.member)})
                                                </small>
                                            `
                                            : ""
                                    }

                                    <br>

                                    <small class="locked">
                                        ${escapeHtml(e.date)}
                                    </small>

                                </div>

                                <strong
                                    class="${
                                        e.type === "income"
                                            ? "income"
                                            : "expense"
                                    }">

                                    ${
                                        e.type === "income"
                                            ? "+"
                                            : "-"
                                    }

                                    ৳${Number(e.amount).toFixed(2)}

                                </strong>

                            </div>
                        `;

                    })
                    .join("")

                : '<p class="locked">No account entries yet.</p>';
    }

    renderMemberSummary();
}


/* =========================================================
   MEAL TOTAL
========================================================= */

function totalMealsForMember(name) {
    let total = 0;

    Object.keys(state.meals || {})
        .forEach(function (dateKey) {

            const day =
                state.meals[dateKey];

            const m =
                day && day[name];

            if (m) {

                total +=
                    Number(m.meal1) || 0;

                total +=
                    Number(m.meal2) || 0;

                total +=
                    Number(m.guest) || 0;
            }
        });

    return total;
}

let myAnalyticsChart = null;

function renderAnalyticsChart(income, expense) {
    const canvas = document.getElementById("analyticsChart");
    if (!canvas || typeof Chart === "undefined") return;

    if (myAnalyticsChart) {
        myAnalyticsChart.destroy();
        myAnalyticsChart = null;
    }

    const total = (income || 0) + (expense || 0);
    const balance = Math.max(0, (income || 0) - (expense || 0));

    let bazaar = 0;
    let utilities = 0;
    let others = 0;

    (state.entries || []).forEach(function (e) {
        if (e.type === "expense") {
            const amt = Number(e.amount || 0);
            const text = (e.text || "").toLowerCase();
            if (text.includes("বাজার") || text.includes("bazaar") || text.includes("bazar") || text.includes("chicken") || text.includes("fish") || text.includes("egg") || text.includes("meat")) {
                bazaar += amt;
            } else if (text.includes("গ্যাস") || text.includes("বিদ্যুৎ") || text.includes("bill") || text.includes("gas") || text.includes("current") || text.includes("wifi")) {
                utilities += amt;
            } else {
                others += amt;
            }
        }
    });

    if (bazaar === 0 && utilities === 0 && others === 0 && expense > 0) {
        bazaar = expense;
    }

    const ctx = canvas.getContext("2d");
    myAnalyticsChart = new Chart(ctx, {
        type: "doughnut",
        data: {
            labels: ["বাজার (Bazaar)", "ইউটিলিটি/বিল (Utilities)", "অন্যান্য (Others)", "অবশিষ্ট ব্যালেন্স (Balance)"],
            datasets: [{
                data: total > 0 ? [bazaar, utilities, others, balance] : [1, 0, 0, 0],
                backgroundColor: [
                    "#0f766e",
                    "#f59e0b",
                    "#ef4444",
                    "#3b82f6"
                ],
                borderWidth: 2,
                borderColor: "#ffffff"
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: "right",
                    labels: {
                        boxWidth: 14,
                        padding: 10,
                        font: { size: 12, family: "'Poppins', sans-serif" }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            return context.label + ": ৳" + Number(context.raw || 0).toFixed(2);
                        }
                    }
                }
            }
        }
    });
}

function exportToCsv() {
    if (!state.entries || state.entries.length === 0) {
        alert("কোনো হিসাব এন্ট্রি নেই এক্সপোর্ট করার জন্য।");
        return;
    }

    let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
    csvContent += "Type,Member,Amount (BDT),Details,Date\n";

    state.entries.forEach(function (e) {
        const type = e.type === "income" ? "Income (জমা)" : "Expense (খরচ)";
        const member = `"${(e.member || "").replace(/"/g, '""')}"`;
        const amount = Number(e.amount || 0).toFixed(2);
        const details = `"${(e.text || "").replace(/"/g, '""')}"`;
        const date = `"${(e.date || "").replace(/"/g, '""')}"`;

        csvContent += `${type},${member},${amount},${details},${date}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    const fileName = "Hisab_Mess_Accounts_" + (state.messCode || "Export") + "_" + new Date().toISOString().slice(0, 10) + ".csv";
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}


/* =========================================================
   MEMBER SUMMARY
========================================================= */

function renderMemberSummary() {
    const el =
        document.getElementById(
            "memberSummaryList"
        );

    if (!el) return;

    const members =
        state.members || [];

    if (!members.length) {
        el.innerHTML =
            '<p class="locked">No members added yet.</p>';

        return;
    }

    const rate =
        computeMealRate();

    el.innerHTML =
        members.map(function (name) {

            const meals =
                totalMealsForMember(name);

            const deposit =
                state.entries
                    .filter(function (e) {
                        return (
                            e.type === "income" &&
                            e.member === name
                        );
                    })
                    .reduce(function (a, b) {
                        return a + Number(b.amount || 0);
                    }, 0);

            const mealCost =
                meals * rate;

            const balance =
                deposit - mealCost;

            const balClass =
                balance >= 0
                    ? "positive"
                    : "negative";

            const balLabel =
                balance >= 0
                    ? "পাবে"
                    : "দিতে হবে";

            return `
                <div class="member-summary-row">

                    <div>

                        <div class="member-summary-name">
                            ${escapeHtml(name)}
                        </div>

                        <div class="member-summary-detail">
                            ${meals} meals ·
                            জমা ৳${deposit.toFixed(2)} ·
                            মিল খরচ ৳${mealCost.toFixed(2)}
                        </div>

                    </div>

                    <div
                        class="member-summary-balance ${balClass}">

                        ৳${Math.abs(balance).toFixed(2)}
                        ${balLabel}

                    </div>

                </div>
            `;

        }).join("") +

        `
            <p class="locked" style="margin-top:10px">
                Meal rate: ৳${rate.toFixed(2)} / meal
                (total expense ÷ total meals)
            </p>
        `;
}


/* =========================================================
   HISTORY
========================================================= */

function renderHistory() {
    const el =
        document.getElementById("historyList");

    if (!el) return;

    el.innerHTML =
        state.history.length

            ? state.history
                .map(function (h) {
                    return `
                        <div class="history-item">
                            ${escapeHtml(h.text)}
                            <br>
                            <small>
                                ${escapeHtml(h.date)}
                            </small>
                        </div>
                    `;
                })
                .join("")

            : '<p class="locked">No activity yet.</p>';
}

function log(text) {
    state.history.unshift({
        id: generateId(),
        ts: Date.now(),
        text: text,
        date: new Date().toLocaleString()
    });

    if (state.history.length > 100) {
        state.history.pop();
    }
}


/* =========================================================
   RENDER ALL
========================================================= */

function showCopyToast(message) {
    const toast = document.getElementById("copyToast");

    if (!toast) return;

    toast.textContent = message;
    toast.classList.add("show");

    if (showCopyToast.timer) {
        clearTimeout(showCopyToast.timer);
    }

    showCopyToast.timer = setTimeout(function () {
        toast.classList.remove("show");
    }, 1400);
}

function renderMessInfo() {
    const nameEl =
        document.getElementById("messInfoManagerName");

    const phoneEl =
        document.getElementById("messInfoManagerPhone");

    const codeEl =
        document.getElementById("messInfoCode");

    const managerName =
        state.manager || "Not set";

    if (nameEl) {
        nameEl.textContent = managerName;
    }

    const managerAvatarEl =
        document.getElementById("homeWelcomeAvatarLarge");
    const managerPhoto =
        state.user &&
        state.manager === state.user.name &&
        state.user.photo
            ? state.user.photo
            : "";

    if (managerAvatarEl) {
        managerAvatarEl.innerHTML = managerPhoto
            ? `<img src="${managerPhoto}" alt="Manager profile picture">`
            : initials(managerName);
    }

    const managerPhone =
        state.managerPhone ||
        (
            state.user &&
            state.manager === state.user.name
                ? state.user.phone
                : ""
        );

    if (phoneEl) {
        if (managerPhone) {
            phoneEl.textContent = managerPhone;
            phoneEl.href = "tel:" + managerPhone;
            phoneEl.style.display = "inline";
        } else {
            phoneEl.textContent = "Not set";
            phoneEl.removeAttribute("href");
            phoneEl.style.display = "inline";
        }
    }

    const messCode =
        state.messCode ||
        localStorage.getItem("messCode") ||
        "";

    if (codeEl) {
        codeEl.textContent = messCode || "Not set";
    }
}

async function copyMessCode() {
    const messCode =
        state.messCode ||
        localStorage.getItem("messCode") ||
        "";

    if (!messCode) {
        showCopyToast("No mess code available");
        return;
    }

    try {
        if (navigator.clipboard && window.isSecureContext) {
            try {
                await navigator.clipboard.writeText(messCode);
                showCopyToast("Mess code copied");
                return;
            } catch (clipboardError) {
                console.warn("Clipboard API failed, using fallback:", clipboardError);
            }
        }

        const helper = document.createElement("textarea");
        helper.value = messCode;
        helper.setAttribute("readonly", "");
        helper.style.position = "fixed";
        helper.style.left = "-9999px";
        helper.style.top = "-9999px";
        document.body.appendChild(helper);
        helper.focus();
        helper.select();

        const copied = document.execCommand("copy");

        document.body.removeChild(helper);

        if (!copied) {
            throw new Error("execCommand copy failed");
        }

        showCopyToast("Mess code copied");
    } catch (error) {
        console.error("Copy code failed:", error);
        showCopyToast("Copy failed");
    }
}

function updateManagerLockButtons() {
    const lockEls = [
        document.getElementById("managerLockState"),
        document.getElementById("homeManagerLockState")
    ];

    const locked = !state.managerUnlocked;

    lockEls.forEach(function (el) {
        if (!el) return;

        el.classList.toggle("unlocked", !locked);
        el.textContent = locked ? "🔒 Locked" : "🔓 Unlocked";
        el.title = locked ? "Click to unlock manager controls" : "Manager controls unlocked";
    });
}

function renderAll() {
    const u = state.user;

    const welcomeNameEl = document.getElementById("homeWelcomeName");
    const welcomeAvatarEl = document.getElementById("homeWelcomeAvatar");
    const welcomeAvatarLargeEl = document.getElementById("homeWelcomeAvatarLarge");

    const displayName = (state.user && state.user.name) || state.manager || "Not set";

    if (welcomeNameEl) {
        welcomeNameEl.textContent = displayName.toUpperCase();
    }

    if (welcomeAvatarEl) {
        welcomeAvatarEl.textContent = initials(displayName);
    }

    if (welcomeAvatarLargeEl) {
        welcomeAvatarLargeEl.textContent = initials(displayName);
    }

    if (u) {

        const managerNameEl =
            document.getElementById("managerName");

        const homeManagerNameEl =
            document.getElementById("homeManagerName");

        const managerAvatarEl =
            document.getElementById("managerAvatar");

        const homeManagerAvatarEl =
            document.getElementById("homeManagerAvatar");

        if (managerNameEl) {
            managerNameEl.textContent =
                state.manager;
        }

        if (homeManagerNameEl) {
            homeManagerNameEl.textContent =
                state.manager;
        }

        if (managerAvatarEl) {
            managerAvatarEl.textContent =
                initials(state.manager);
        }

        if (homeManagerAvatarEl) {
            homeManagerAvatarEl.textContent =
                initials(state.manager);
        }

        const phoneRow =
            document.getElementById(
                "homeManagerPhoneRow"
            );

        const phoneLink =
            document.getElementById(
                "homeManagerPhone"
            );

        const managerPhone =
            state.managerPhone ||
            (
                state.manager === u.name
                    ? u.phone
                    : ""
            );

        if (phoneRow && phoneLink) {

            if (managerPhone) {

                phoneLink.textContent =
                    managerPhone;

                phoneLink.href =
                    "tel:" + managerPhone;

                phoneRow.classList.remove("hidden");

            } else {

                phoneRow.classList.add("hidden");
            }
        }
    }

    updateManagerLockButtons();
    renderMessInfo();
    renderHomeMenu();
    renderSidebarProfile();
    renderSidebarManagerLock();

    const memberCountEl = document.getElementById("homeMemberCount");
    if (memberCountEl) {
        memberCountEl.textContent = String((state.members || []).length);
    }

    renderMeals();
    renderAccounts();
    renderHistory();
    renderNotices();
    renderManagerPanel();
    renderMemberInfoPage();

    const privacy =
        document.getElementById("privacySelect");

    if (privacy) {
        privacy.value =
            state.privacy || "private";
    }

    const mealCount =
        document.getElementById("mealCount");

    if (mealCount) {
        let total =
            0;

        Object.values(state.meals || {})
            .forEach(function (day) {

                if (!day || typeof day !== "object") {
                    return;
                }

                Object.values(day)
                    .forEach(function (m) {

                        if (!m || typeof m !== "object") {
                            return;
                        }

                        total +=
                            Number(m.meal1) || 0;

                        total +=
                            Number(m.meal2) || 0;

                    });
            });

        mealCount.textContent =
            total;
    }
}


/* =========================================================
   THEME
========================================================= */

/* =========================================================
   APP SIDEBAR (Nav view <-> Profile view)
========================================================= */

function openSidebarProfile() {
    const sidebar = document.getElementById("appSidebar");

    if (!sidebar) return;

    sidebar.classList.add("profile-open");
    updateSidebarCurrentWidth();
}

function closeSidebarProfile() {
    const sidebar = document.getElementById("appSidebar");

    if (!sidebar) return;

    sidebar.classList.remove("profile-open");
    updateSidebarCurrentWidth();
}

function renderSidebarProfile() {

    const u = state.user;

    const displayName =
        (u && u.name) ||
        state.manager ||
        "Not set";

    const nameEl =
        document.getElementById("sidebarUserNameLg");
    const navNameEl =
        document.getElementById("sidebarNavUserName");

    if (nameEl) {
        nameEl.textContent = displayName;
    }
    if (navNameEl) {
        navNameEl.textContent = displayName.toUpperCase();
    }

    const avatarHtml = (u && u.photo) ?
        `<img src="${u.photo}" alt="Profile">` :
        initials(displayName);

    const avatarEl =
        document.getElementById("sidebarAvatar");

    if (avatarEl) {
        avatarEl.innerHTML = avatarHtml;
    }

    const avatarLgEl =
        document.getElementById("sidebarAvatarLg");

    if (avatarLgEl) {
        avatarLgEl.innerHTML = avatarHtml;
    }

    const phonePill =
        document.querySelector("#sidebarPhonePill .sidebar-pill-text");

    if (phonePill) {
        phonePill.textContent =
            (u && u.phone) || "Phone";
    }

    const gmailPill =
        document.querySelector("#sidebarGmailPill .sidebar-pill-text");

    if (gmailPill) {
        gmailPill.textContent =
            (u && u.email) || "Gmail";
    }

    const birthdayPill =
        document.querySelector("#sidebarBirthdayPill .sidebar-pill-text");

    if (birthdayPill) {
        birthdayPill.textContent =
            (u && u.birthday) || "Birthday";
    }
}

function renderSidebarManagerLock() {

    const locked =
        !state.managerUnlocked;

    ["sidebarManagerLockBtn", "sidebarManagerLockBtnLg"].forEach(function (id) {

        const btn =
            document.getElementById(id);

        if (!btn) return;

        const icon =
            btn.querySelector(".sidebar-nav-icon");

        const label =
            btn.querySelector(".sidebar-nav-label");

        if (icon) {
            icon.textContent = locked ? "🔒" : "🔓";
        }

        if (label) {
            label.textContent =
                locked ? "Manage..." : "Manage...";
        }
    });
}

function updateSidebarCurrentWidth() {
    const sidebar = document.getElementById("appSidebar");

    if (!sidebar) return;

    const width = sidebar.classList.contains("profile-open")
        ? getComputedStyle(document.documentElement).getPropertyValue("--sidebar-width-profile").trim()
        : getComputedStyle(document.documentElement).getPropertyValue("--sidebar-width-nav").trim();

    document.documentElement.style.setProperty("--sidebar-current-width", width);
}

function toggleSidebar() {
    const sidebar = document.getElementById("appSidebar");

    if (!sidebar) return;

    const compact = sidebar.classList.contains("collapsed");
    sidebar.classList.toggle("collapsed", !compact);
    sidebar.classList.toggle("profile-open", compact);
    sidebar.setAttribute("aria-expanded", compact ? "true" : "false");
    updateSidebarCurrentWidth();
}

function collapseSidebar() {
    const sidebar = document.getElementById("appSidebar");
    if (!sidebar) return;

    sidebar.classList.add("collapsed");
    sidebar.classList.remove("profile-open");
    sidebar.setAttribute("aria-expanded", "false");
    updateSidebarCurrentWidth();
}

function toggleTheme() {
    document.body.classList.toggle("dark");

    const dark =
        document.body.classList.contains("dark");
    localStorage.setItem("hisab_theme", dark ? "dark" : "light");

    if (dark) {

        document.documentElement.style.setProperty(
            "--bg",
            "#111827"
        );

        document.documentElement.style.setProperty(
            "--card",
            "#1f2937"
        );

        document.documentElement.style.setProperty(
            "--text",
            "#f9fafb"
        );

        document.documentElement.style.setProperty(
            "--border",
            "#374151"
        );

    } else {

        document.documentElement.style.setProperty(
            "--bg",
            "#f4f6f7"
        );

        document.documentElement.style.setProperty(
            "--card",
            "#ffffff"
        );

        document.documentElement.style.setProperty(
            "--text",
            "#1f2937"
        );

        document.documentElement.style.setProperty(
            "--border",
            "#e5e7eb"
        );
    }
}

if (localStorage.getItem("hisab_theme") === "dark") {
    document.body.classList.add("dark");
}


/* =========================================================
   LANGUAGE
========================================================= */

function toggleLanguage() {
    state.language =
        state.language === "bn"
            ? "en"
            : "bn";

    save();

    applyLanguage();
    renderAll();
}

function applyLanguage() {
    const lang =
        state.language === "bn"
            ? "bn"
            : "en";

    if (typeof translations === "undefined") {
        return;
    }

    document.documentElement.lang = lang;
    document.title = translations.appTitle && translations.appTitle[lang]
        ? translations.appTitle[lang]
        : document.title;

    document
        .querySelectorAll("[data-i18n]")
        .forEach(function (el) {

            const key =
                el.getAttribute("data-i18n");

            const entry =
                translations[key];

            if (!entry) return;

            el.textContent =
                entry[lang];
        });
}


/* =========================================================
   MANAGER
========================================================= */

function isManager() {
    return !!state.user &&
        state.manager === state.user.name;
}

function requireManager() {
    if (!isManager()) {
        alert(
            "Only the current manager can use this option."
        );

        return false;
    }

    return true;
}

let preManagerPage = "home";

let pendingPinDialogResolve = null;

function openPinDialog(options) {
    const modal = document.getElementById("managerPinModal");
    const title = document.getElementById("pinDialogTitle");
    const hint = document.getElementById("pinDialogHint");
    const input = document.getElementById("pinInput");
    const confirmBtn = document.getElementById("pinDialogConfirmBtn");

    if (!modal || !title || !hint || !input || !confirmBtn) {
        return Promise.resolve(null);
    }

    return new Promise(function(resolve) {
        pendingPinDialogResolve = resolve;

        title.textContent = options.title || "Manager PIN";
        hint.textContent = options.hint || "Enter your Manager PIN.";
        input.type = "password";
        input.maxLength = 6;
        input.placeholder = options.placeholder || "Enter 4-6 digits";
        input.value = "";
        input.focus();

        confirmBtn.textContent = options.confirmText || "Continue";

        const finish = function(value) {
            modal.classList.remove("open");
            pendingPinDialogResolve = null;
            resolve(value);
        };

        confirmBtn.onclick = function() {
            finish(input.value.trim());
        };

        input.onkeydown = function(event) {
            if (event.key === "Enter") {
                finish(input.value.trim());
            }
        };

        modal.classList.add("open");
    });
}

function submitPinDialog() {
    const modal = document.getElementById("managerPinModal");
    const input = document.getElementById("pinInput");

    if (!modal || !input) {
        return;
    }

    const value = input.value.trim();

    if (pendingPinDialogResolve) {
        const resolve = pendingPinDialogResolve;
        pendingPinDialogResolve = null;
        modal.classList.remove("open");
        resolve(value);
    }
}

function cancelPinDialog() {
    const modal = document.getElementById("managerPinModal");
    const input = document.getElementById("pinInput");

    if (!modal || !input) {
        return;
    }

    input.value = "";
    modal.classList.remove("open");

    if (pendingPinDialogResolve) {
        const resolve = pendingPinDialogResolve;
        pendingPinDialogResolve = null;
        resolve(null);
    }
}

async function requestManagerPin({ title, hint, placeholder, confirmText, allowEmpty }) {
    const pin = await openPinDialog({
        title: title,
        hint: hint,
        placeholder: placeholder,
        confirmText: confirmText || "Continue"
    });

    if (pin === null) {
        return null;
    }

    if (!allowEmpty && !/^\d{4,6}$/.test(pin)) {
        alert("PIN must contain 4 to 6 digits.");
        return await requestManagerPin({
            title: title,
            hint: hint,
            placeholder: placeholder,
            confirmText: confirmText,
            allowEmpty: allowEmpty
        });
    }

    return pin;
}

async function hashPin(pin) {
    if (!pin) return "";
    const msgBuffer = new TextEncoder().encode(String(pin) + "_hisab_salt_v1");
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

async function verifyPin(enteredPin) {
    if (!state.managerPin || !enteredPin) return false;
    const hashedEntered = await hashPin(enteredPin);
    if (String(state.managerPin) === String(enteredPin)) {
        state.managerPin = hashedEntered;
        save();
        return true;
    }
    return state.managerPin === hashedEntered;
}

async function toggleManagerLock() {
    if (!state.user) {
        return;
    }

    if (!isManager()) {
        alert("Only the current manager can unlock manager controls.");
        return;
    }

    if (state.managerUnlocked) {
        state.managerUnlocked = false;
        save();
        renderAll();
        return;
    }

    if (!state.managerPin) {
        const pin = await requestManagerPin({
            title: "Create Manager PIN",
            hint: "Set a 4-6 digit PIN to protect manager controls.",
            placeholder: "4-6 digits",
            confirmText: "Create PIN"
        });

        if (pin === null) {
            return;
        }

        state.managerPin = await hashPin(pin);
        log("Manager PIN created");
        save();
    }

    const pin = await requestManagerPin({
        title: "Manager PIN",
        hint: "Enter the current Manager PIN to unlock controls.",
        placeholder: "Enter 4-6 digits",
        confirmText: "Unlock"
    });

    if (pin === null) {
        return;
    }

    if (!(await verifyPin(pin))) {
        alert("Incorrect PIN");
        return;
    }

    state.managerUnlocked = true;
    save();
    renderAll();
    openManagerPanel(true);
}

async function openManagerPanel(skipPinCheck) {
    if (!requireManager()) {
        return;
    }

    const activeEl =
        document.querySelector(".page.active");

    if (
        activeEl &&
        ["home", "meals", "accounts"].includes(activeEl.id)
    ) {
        preManagerPage =
            activeEl.id;
    }

    if (!skipPinCheck && !state.managerUnlocked) {
        if (!state.managerPin) {
            const pin = await requestManagerPin({
                title: "Create Manager PIN",
                hint: "Set a 4-6 digit PIN to protect manager controls.",
                placeholder: "4-6 digits",
                confirmText: "Create PIN"
            });

            if (pin === null) {
                return;
            }

            state.managerPin = await hashPin(pin);
            log("Manager PIN created");

        } else {
            const pin = await requestManagerPin({
                title: "Manager PIN",
                hint: "Enter the current Manager PIN to continue.",
                placeholder: "Enter 4-6 digits",
                confirmText: "Unlock"
            });

            if (pin === null) {
                return;
            }

            if (!(await verifyPin(pin))) {
                alert("Incorrect PIN");
                return;
            }
        }
    }

    state.managerUnlocked = true;

    save();

    closeModal("profileModal");

    document
        .querySelectorAll(".page")
        .forEach(function (x) {
            x.classList.remove("active");
        });

    const panel =
        document.getElementById("managerPanel");

    if (panel) {
        panel.classList.add("active");
    }

    lockManagerMode();

    renderAll();
    renderManagerPanel();
}


/*
   MANAGER MODE GUARD

   Manager Panel-এ ঢোকার পর নিচের home/meals/accounts tabs-এ যাতে
   ভুলে ট্যাপ না লেগে যায়, তাই ঐ tab bar-টা পুরোপুরি hide করে
   দেওয়া হয়। Manager Panel-এর নিজের কোনো style/position touch করা
   হয় না, শুধু bottom tabs। বের হলে (closeManagerPanel) tabs আবার
   ফিরে আসবে।
*/

function lockManagerMode() {
    const tabs =
        document.querySelector(".tabs");

    if (tabs) {
        tabs.dataset.prevDisplay =
            tabs.style.display || "";

        tabs.style.display = "none";
    }

    /*
       So the phone's hardware/gesture Back button closes Manager
       Panel instead of leaving the page or landing on a confusing
       half-state.
    */
    history.pushState(
        { managerMode: true },
        ""
    );
}

function unlockManagerMode() {
    const tabs =
        document.querySelector(".tabs");

    if (tabs) {
        tabs.style.display =
            tabs.dataset.prevDisplay || "";
    }
}

window.addEventListener("popstate", function (e) {
    const managerPanel =
        document.getElementById("managerPanel");

    if (
        managerPanel &&
        managerPanel.classList.contains("active")
    ) {
        closeManagerPanel(true);
    }
});


function closeManagerPanel(fromBackButton) {
    const panel =
        document.getElementById("managerPanel");

    if (panel) {
        panel.classList.remove("active");
    }

    unlockManagerMode();

    /*
       We pushed one history entry on open (see lockManagerMode) so
       the hardware/gesture Back button would close this panel
       instead of leaving the page. If we're closing via the panel's
       own Close button (fromBackButton is falsy), that pushed entry
       is still sitting there unused — consume it now with
       history.back() so a later real Back press doesn't do a
       confusing extra step. If we're already here BECAUSE of that
       Back press (fromBackButton is true), the entry is already
       consumed — don't call history.back() again.
    */
    if (!fromBackButton) {
        history.back();
    }

    state.managerUnlocked = false;

    save();

    document
        .querySelectorAll(".page")
        .forEach(function (x) {
            x.classList.remove("active");
        });

    const targetId =
        (
            preManagerPage &&
            document.getElementById(preManagerPage)
        )
            ? preManagerPage
            : "home";

    document
        .getElementById(targetId)
        ?.classList.add("active");

    document
        .querySelectorAll(".tabs button")
        .forEach(function (b) {
            b.classList.remove("active");
        });

    const tabIndex =
        targetId === "meals"
            ? 1
            : targetId === "accounts"
                ? 2
                : 0;

    document
        .querySelectorAll(".tabs button")[tabIndex]
        ?.classList.add("active");

    renderAll();
}


/* =========================================================
   MANAGER PANEL
========================================================= */

function renderManagerPanel() {
    const select =
        document.getElementById("managerSelect");

    if (!select) {
        return;
    }

    select.innerHTML =
        (state.members || [])
            .map(function (m) {

                return `
                    <option
                        value="${escapeHtml(m)}"
                        ${m === state.manager ? "selected" : ""}>

                        ${escapeHtml(m)}
                        ${m === state.manager ? " 👑" : ""}

                    </option>
                `;

            })
            .join("");

    const phoneInput =
        document.getElementById(
            "managerPhoneInput"
        );

    if (phoneInput) {
        phoneInput.value =
            state.managerPhone || "";
    }

    const memberList =
        document.getElementById("memberList");

    if (memberList) {

        memberList.innerHTML =
            (state.members || [])
                .map(function (m) {

                    return `
                        <div class="member-chip">

                            <span>
                                ${escapeHtml(m)}
                                ${
                                    m === state.manager
                                        ? " 👑 Manager"
                                        : ""
                                }
                            </span>

                            ${
                                m !== state.manager
                                    ? `
                                        <button
                                            class="link-btn"
                                            onclick="removeMember('${escapeJs(m)}')">
                                            Remove
                                        </button>
                                    `
                                    : ""
                            }

                        </div>
                    `;

                })
                .join("");
    }

    const t1 =
        document.getElementById(
            "meal1CutoffInput"
        );

    const t2 =
        document.getElementById(
            "meal2CutoffInput"
        );

    if (t1) {
        t1.value =
            state.mealTimes?.meal1 || "10:00";
    }

    if (t2) {
        t2.value =
            state.mealTimes?.meal2 || "20:00";
    }

    renderMenuManagerControls();
}


/* =========================================================
   HOME COOKING MENU
========================================================= */

let cookingMenuQuickTarget = "meal1";

function openHomeCookingMenuEditor() {
    if (!requireManager()) {
        alert("শুধু Manager এই মেনু সেট করতে পারবে।");
        return;
    }

    renderCookingMenuModal();

    const modal = document.getElementById("cookingMenuModal");
    if (modal) modal.classList.add("open");
}

function closeCookingMenuModalAndSave() {
    save();
    renderHomeMenu();
    closeModal("cookingMenuModal");
}

function setCookingMenuQuickTarget(mealKey) {
    cookingMenuQuickTarget = mealKey;
    const btn1 = document.getElementById("cookingMenuTargetMeal1");
    const btn2 = document.getElementById("cookingMenuTargetMeal2");
    if (btn1) btn1.classList.toggle("active", mealKey === "meal1");
    if (btn2) btn2.classList.toggle("active", mealKey === "meal2");
}

async function unlockCookingMenuModal() {
    if (state.managerUnlocked) return;

    if (!state.managerPin) {
        const pin = await requestManagerPin({
            title: "Create Manager PIN",
            hint: "Set a 4-6 digit PIN to protect manager controls.",
            placeholder: "4-6 digits",
            confirmText: "Create PIN"
        });
        if (pin === null) return;
        state.managerPin = await hashPin(pin);
        log("Manager PIN created");
    } else {
        const pin = await requestManagerPin({
            title: "Manager PIN",
            hint: "Enter the current Manager PIN to continue.",
            placeholder: "Enter 4-6 digits",
            confirmText: "Unlock"
        });
        if (pin === null) return;
        if (!(await verifyPin(pin))) {
            alert("Incorrect PIN");
            return;
        }
    }

    state.managerUnlocked = true;
    save();
    renderCookingMenuModal();
    renderHomeMenu();
}

function renderCookingMenuModal() {
    const unlocked = !!state.managerUnlocked;

    const badge = document.getElementById("cookingMenuLockBadge");
    if (badge) {
        badge.classList.toggle("unlocked", unlocked);
        badge.innerHTML = unlocked ? "🔓 Unlocked" : "🔒 Locked - Enter PIN";
    }

    if (!Array.isArray(state.menuOptions)) state.menuOptions = DEFAULT_MENU_OPTIONS.slice();
    const options = Array.from(new Set(DEFAULT_MENU_OPTIONS.concat(state.menuOptions).filter(Boolean)));
    state.menuOptions = options;

    const chipsEl = document.getElementById("cookingMenuQuickChips");
    if (chipsEl) {
        chipsEl.innerHTML = options.map(function(item) {
            return '<button type="button" class="cooking-menu-chip" onclick="addQuickCookingMenuItem(\'' + escapeJs(item) + '\')">＋ ' + escapeHtml(item) + '</button>';
        }).join("") + '<button type="button" class="cooking-menu-chip cooking-menu-chip-add-new" onclick="addNewCookingMenuItem()">＋ নতুন রান্না</button>';
    }

    const menu = state.menu || { meal1: [], meal2: [] };

    function renderList(el, items, mealKey) {
        if (!el) return;
        const clean = Array.isArray(items) ? items.filter(Boolean) : [];
        if (!clean.length) {
            el.innerHTML = '<div class="cooking-menu-item-empty">এখনো কিছু যোগ করা হয়নি</div>';
            return;
        }
        el.innerHTML = clean.map(function(item, index) {
            return '<div class="cooking-menu-item-row">' +
                '<span class="cooking-menu-item-number">' + toBengaliDigits(index + 1) + '</span>' +
                '<span class="cooking-menu-item-name">' + escapeHtml(item) + '</span>' +
                '<button type="button" class="cooking-menu-item-del" onclick="removeCookingMenuItem(\'' + mealKey + '\', ' + index + ')">[✕]</button>' +
                '</div>';
        }).join("");
    }

    renderList(document.getElementById("cookingMenuList1"), menu.meal1, "meal1");
    renderList(document.getElementById("cookingMenuList2"), menu.meal2, "meal2");
}

async function addQuickCookingMenuItem(item) {
    if (!state.managerUnlocked) {
        await unlockCookingMenuModal();
        if (!state.managerUnlocked) return;
    }

    if (!state.menu) state.menu = { meal1: [], meal2: [] };
    const mealKey = cookingMenuQuickTarget || "meal1";
    if (!Array.isArray(state.menu[mealKey])) state.menu[mealKey] = [];

    const exists = state.menu[mealKey].some(function(x) { return String(x).trim().toLowerCase() === String(item).trim().toLowerCase(); });
    if (!exists) state.menu[mealKey].push(String(item));

    save();
    renderCookingMenuModal();
    renderHomeMenu();
}

async function addNewCookingMenuItem() {
    if (!state.managerUnlocked) {
        await unlockCookingMenuModal();
        if (!state.managerUnlocked) return;
    }

    const item = prompt("নতুন রান্নার নাম লিখুন:");
    if (item === null) return;
    const trimmed = item.trim();
    if (!trimmed) return;

    if (!Array.isArray(state.menuOptions)) state.menuOptions = DEFAULT_MENU_OPTIONS.slice();
    const existsInOptions = state.menuOptions.some(function(x) { return String(x).trim().toLowerCase() === trimmed.toLowerCase(); });
    if (!existsInOptions) state.menuOptions.push(trimmed);

    await addQuickCookingMenuItem(trimmed);
}

function removeCookingMenuItem(mealKey, index) {
    if (!state.managerUnlocked) {
        alert("আগে Manager PIN দিয়ে Unlock করুন।");
        return;
    }
    if (!state.menu || !Array.isArray(state.menu[mealKey])) return;
    state.menu[mealKey].splice(index, 1);
    save();
    renderCookingMenuModal();
    renderHomeMenu();
}

const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

function toBengaliDigits(value) {
    return String(value).replace(/[0-9]/g, function(d) { return BN_DIGITS[Number(d)]; });
}

function formatMealTime12h(hhmm) {
    if (!hhmm || typeof hhmm !== "string" || hhmm.indexOf(":") === -1) return "";
    const parts = hhmm.split(":");
    let hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10) || 0;
    if (isNaN(hours)) return "";
    const suffix = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    if (hours === 0) hours = 12;
    const minText = String(minutes).padStart(2, "0");
    return toBengaliDigits(hours) + ":" + toBengaliDigits(minText) + " " + suffix;
}

function formatTodayBengali() {
    try {
        return new Date().toLocaleDateString("bn-BD", { day: "numeric", month: "long", year: "numeric" });
    } catch (e) {
        return "";
    }
}

const FOOD_EMOJI_RULES = [
    [["ভাত", "চাল"], "🍚"],
    [["মাছ", "ইলিশ", "রুই", "কই", "চিংড়ি", "টুনা"], "🐟"],
    [["মুরগি", "চিকেন"], "🍗"],
    [["গরু", "খাসি", "মাংস", "কারি", "কষা"], "🍛"],
    [["ডাল"], "🥣"],
    [["ডিম"], "🥚"],
    [["সবজি", "ভাজি", "ভর্তা"], "🥗"],
    [["সালাদ"], "🥬"],
    [["রুটি", "পরোটা", "নান"], "🫓"],
    [["দই"], "🍮"],
    [["মিষ্টি", "পায়েস", "ফিরনি"], "🍮"]
];

function getFoodEmoji(name) {
    const text = String(name || "");
    for (let i = 0; i < FOOD_EMOJI_RULES.length; i++) {
        const keywords = FOOD_EMOJI_RULES[i][0];
        const emoji = FOOD_EMOJI_RULES[i][1];
        if (keywords.some(function(k) { return text.indexOf(k) !== -1; })) {
            return emoji;
        }
    }
    return "🍽️";
}

window.renderHomeMenu = function renderHomeMenu() {
    const meal1El = document.getElementById("homeMenuMeal1");
    const meal2El = document.getElementById("homeMenuMeal2");
    if (!state || !state.menu) {
        state = state || {};
        state.menu = { meal1: [], meal2: [] };
    }
    const menu = state.menu || { meal1: [], meal2: [] };

    const todayText = formatTodayBengali();
    const date1El = document.getElementById("homeMenuDate1");
    const date2El = document.getElementById("homeMenuDate2");
    if (date1El) date1El.textContent = todayText;
    if (date2El) date2El.textContent = todayText;

    const time1El = document.getElementById("homeMenuTime1");
    const time2El = document.getElementById("homeMenuTime2");
    if (time1El) time1El.textContent = formatMealTime12h(state.mealTimes && state.mealTimes.meal1) || "-";
    if (time2El) time2El.textContent = formatMealTime12h(state.mealTimes && state.mealTimes.meal2) || "-";

    const canEdit = typeof isManager === "function" && isManager() && state.managerUnlocked;

    function renderItems(el, items, mealKey) {
        if (!el) return;
        const clean = Array.isArray(items) ? items.filter(Boolean) : [];
        if (!clean.length) {
            el.innerHTML = '<div class="meal-list-empty">Manager has not set the menu yet</div>';
            return;
        }
        el.innerHTML = clean.map(function(item, index) {
            const actions = canEdit
                ? '<div class="meal-list-row-actions">' +
                    '<button type="button" class="meal-list-edit-btn" title="Edit" onclick="editHomeMenuItem(\'' + mealKey + '\', ' + index + ')">✎</button>' +
                    '<button type="button" class="meal-list-del-btn" title="Delete" onclick="deleteHomeMenuItem(\'' + mealKey + '\', ' + index + ')">✕</button>' +
                  '</div>'
                : '';
            return '<div class="meal-list-row">' +
                '<span class="meal-list-number">' + toBengaliDigits(index + 1) + '</span>' +
                '<span class="meal-list-emoji">' + getFoodEmoji(item) + '</span>' +
                '<span class="meal-list-name">' + escapeHtml(item) + '</span>' +
                actions +
                '</div>';
        }).join("");
    }

    renderItems(meal1El, menu.meal1, "meal1");
    renderItems(meal2El, menu.meal2, "meal2");
};

function editHomeMenuItem(mealKey, index) {
    if (!requireManager() || !state.managerUnlocked) {
        alert("আগে Manager PIN দিয়ে Unlock করুন।");
        return;
    }
    if (!state.menu || !Array.isArray(state.menu[mealKey])) return;
    const current = state.menu[mealKey][index];
    if (current === undefined) return;

    const updated = prompt("রান্নার নাম পরিবর্তন করুন:", current);
    if (updated === null) return;

    const trimmed = updated.trim();
    if (!trimmed) {
        alert("খালি নাম দেওয়া যাবে না।");
        return;
    }

    state.menu[mealKey][index] = trimmed;

    if (!Array.isArray(state.menuOptions)) state.menuOptions = DEFAULT_MENU_OPTIONS.slice();
    if (!state.menuOptions.some(function(x) { return String(x).trim().toLowerCase() === trimmed.toLowerCase(); })) {
        state.menuOptions.push(trimmed);
    }

    save();
    renderHomeMenu();
    renderMenuManagerControls();
}

function deleteHomeMenuItem(mealKey, index) {
    if (!requireManager() || !state.managerUnlocked) {
        alert("আগে Manager PIN দিয়ে Unlock করুন।");
        return;
    }
    if (!state.menu || !Array.isArray(state.menu[mealKey])) return;
    const item = state.menu[mealKey][index];
    if (item === undefined) return;

    if (!confirm('"' + item + '" তালিকা থেকে বাদ দেবেন?')) return;

    state.menu[mealKey].splice(index, 1);
    save();
    renderHomeMenu();
    renderMenuManagerControls();
}

function renderMenuManagerControls() {
    const meal1El = document.getElementById("managerMenuMeal1");
    const meal2El = document.getElementById("managerMenuMeal2");
    if (!meal1El || !meal2El) return;

    const menu = state.menu || { meal1: [], meal2: [] };
    const listText = function(items) {
        return (Array.isArray(items) ? items : []).join("\n");
    };

    meal1El.value = listText(menu.meal1);
    meal2El.value = listText(menu.meal2);

    const list = document.getElementById("managerMenuItemList");
    if (list) {
        const options = Array.from(new Set(
            DEFAULT_MENU_OPTIONS.concat(Array.isArray(state.menuOptions) ? state.menuOptions : []).filter(Boolean)
        ));
        state.menuOptions = options;
        list.innerHTML = options.map(function(item) {
            const custom = DEFAULT_MENU_OPTIONS.includes(item) ? "" : '<span class="menu-custom-badge">Added</span>';
            return '<button type="button" class="manager-menu-list-chip manager-menu-suggestion" onclick="insertMenuItemIntoFocusedField(\'' + escapeJs(item) + '\')">' +
                escapeHtml(item) + custom + '</button>';
        }).join("");
    }
}

function escapeJs(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

let focusedMenuFieldId = "managerMenuMeal1";

document.addEventListener("focusin", function(event) {
    if (event.target && (event.target.id === "managerMenuMeal1" || event.target.id === "managerMenuMeal2")) {
        focusedMenuFieldId = event.target.id;
    }
});

function insertMenuItemIntoFocusedField(item) {
    if (!requireManager() || !state.managerUnlocked) {
        alert("আগে Manager PIN দিয়ে Unlock করুন।");
        return;
    }
    const field = document.getElementById(focusedMenuFieldId || "managerMenuMeal1");
    if (!field) return;
    const current = field.value.trim();
    const lines = current ? current.split(/\r?\n/).map(function(x) { return x.trim(); }).filter(Boolean) : [];
    if (!lines.some(function(x) { return x.toLowerCase() === String(item).toLowerCase(); })) lines.push(String(item));
    field.value = lines.join("\n");
    field.focus();
}

function addManagerMenuItem() {
    if (!requireManager() || !state.managerUnlocked) {
        alert("আগে Manager PIN দিয়ে Unlock করুন।");
        return;
    }

    const input = document.getElementById("managerMenuNewItem");
    if (!input) return;

    const item = String(input.value || "").trim();
    if (!item) {
        input.focus();
        alert("নতুন রান্নার নাম লিখুন।");
        return;
    }

    if (!Array.isArray(state.menuOptions)) {
        state.menuOptions = DEFAULT_MENU_OPTIONS.slice();
    }

    const exists = state.menuOptions.some(function(x) {
        return String(x).trim().toLowerCase() === item.toLowerCase();
    });

    if (exists) {
        alert("এই রান্নাটি List-এ আগে থেকেই আছে।");
        input.focus();
        return;
    }

    state.menuOptions.push(item);
    save();
    input.value = "";
    renderMenuManagerControls();
    input.focus();
}

// Press Enter in the cooking-name field to add it to the manager list.
document.addEventListener("keydown", function(event) {
    if (event.key !== "Enter") return;
    if (event.target && event.target.id === "managerMenuNewItem") {
        event.preventDefault();
        addManagerMenuItem();
    }
});

function saveHomeCookingMenu() {
    if (!requireManager() || !state.managerUnlocked) {
        alert("শুধু PIN দিয়ে Unlock করা Manager রান্নার মেনু সেট করতে পারবে।");
        return;
    }

    function readList(id) {
        const field = document.getElementById(id);
        if (!field) return [];
        const raw = String(field.value || "").replace(/,/g, "\n");
        const seen = new Set();
        return raw.split(/\n+/).map(function(item) { return item.trim(); }).filter(function(item) {
            if (!item) return false;
            const key = item.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    const meal1 = readList("managerMenuMeal1");
    const meal2 = readList("managerMenuMeal2");

    state.menu = { meal1: meal1, meal2: meal2 };

    const allItems = DEFAULT_MENU_OPTIONS.concat(meal1, meal2, Array.isArray(state.menuOptions) ? state.menuOptions : []);
    state.menuOptions = Array.from(new Set(allItems.filter(Boolean).map(function(x) { return String(x).trim(); })));

    save();
    renderHomeMenu();
    renderMenuManagerControls();
    alert("দুই বেলার রান্নার তালিকা সেভ হয়েছে।");
}


/* =========================================================
   MEAL EDIT PAGE
========================================================= */

function openMealEditPage() {
    if (!requireManager() || !state.managerUnlocked) {
        alert(
            "শুধু PIN দিয়ে Unlock করা Manager মিলের হিসাব এডিট করতে পারবে।"
        );

        return;
    }

    document
        .querySelectorAll(".page")
        .forEach(function (x) {
            x.classList.remove("active");
        });

    document
        .getElementById("mealEditPage")
        .classList.add("active");

    renderMealEditPage();
}

function closeMealEditPage() {
    document
        .querySelectorAll(".page")
        .forEach(function (x) {
            x.classList.remove("active");
        });

    document
        .getElementById("managerPanel")
        .classList.add("active");

    renderManagerPanel();
}

function renderMealEditPage() {
    const body =
        document.getElementById(
            "mealEditTableBody"
        );

    if (!body) return;

    const mealData =
        ensureMealData();

    body.innerHTML =
        state.members.length

            ? state.members
                .map(function (m) {

                    const md =
                        mealData[m] || {
                            meal1: 0,
                            meal2: 0,
                            guest: 0
                        };

                    const total =
                        (Number(md.meal1) || 0) +
                        (Number(md.meal2) || 0) +
                        (Number(md.guest) || 0);

                    return `
                        <tr>

                            <td>
                                <div class="meal-edit-name">

                                    <div
                                        class="avatar"
                                        style="
                                            width:28px;
                                            height:28px;
                                            font-size:13px;
                                            flex:0 0 28px;
                                        ">
                                        ${initials(m)}
                                    </div>

                                    ${escapeHtml(m)}

                                </div>
                            </td>

                            <td>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.5"
                                    value="${md.meal1 || 0}"
                                    onchange="
                                        updateMealEditCell(
                                            '${escapeJs(m)}',
                                            'meal1',
                                            this.value
                                        )
                                    ">
                            </td>

                            <td>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.5"
                                    value="${md.meal2 || 0}"
                                    onchange="
                                        updateMealEditCell(
                                            '${escapeJs(m)}',
                                            'meal2',
                                            this.value
                                        )
                                    ">
                            </td>

                            <td>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.5"
                                    value="${md.guest || 0}"
                                    onchange="
                                        updateMealEditCell(
                                            '${escapeJs(m)}',
                                            'guest',
                                            this.value
                                        )
                                    ">
                            </td>

                            <td class="meal-edit-total">
                                ${total}
                            </td>

                        </tr>
                    `;

                })
                .join("")

            : `
                <tr>
                    <td colspan="5" class="locked">
                        No members added yet.
                    </td>
                </tr>
            `;
}

function updateMealEditCell(
    name,
    field,
    value
) {
    if (!requireManager() || !state.managerUnlocked) {
        alert(
            "শুধু PIN দিয়ে Unlock করা Manager মিলের হিসাব এডিট করতে পারবে।"
        );

        renderMealEditPage();

        return;
    }

    const num =
        Number(value);

    if (isNaN(num) || num < 0) {
        alert(
            "সঠিক সংখ্যা দিন (0 বা তার বেশি)।"
        );

        renderMealEditPage();

        return;
    }

    const data =
        ensureMealData();

    if (!data[name]) {
        data[name] = {
            meal1: 0,
            meal2: 0,
            guest: 0
        };
    }

    data[name][field] = num;

    log(
        "Manager set " +
        name +
        "'s " +
        (
            field === "meal1"
                ? "Meal 1"
                : field === "meal2"
                    ? "Meal 2"
                    : "Guest meal"
        ) +
        " to " +
        num
    );

    save();

    renderMeals();
    renderManagerPanel();
    renderMealEditPage();
}


/* =========================================================
   MANAGER PIN
========================================================= */

async function changeManagerPin() {
    if (!requireManager() || !state.managerUnlocked) {
        return;
    }

    const oldPin = await requestManagerPin({
        title: "Current Manager PIN",
        hint: "Enter the current Manager PIN to continue.",
        placeholder: "Enter current PIN",
        confirmText: "Verify"
    });

    if (oldPin === null) {
        return;
    }

    if (!(await verifyPin(oldPin))) {
        alert("Wrong current PIN.");
        return;
    }

    const newPin = await requestManagerPin({
        title: "New Manager PIN",
        hint: "Choose a new 4-6 digit PIN.",
        placeholder: "4-6 digits",
        confirmText: "Save PIN"
    });

    if (newPin === null) {
        return;
    }

    if (!/^\d{4,6}$/.test(newPin)) {
        alert("PIN must contain 4 to 6 digits.");
        return;
    }

    state.managerPin = await hashPin(newPin);

    log("Manager PIN changed");

    save();

    alert("Manager PIN updated.");
}


/* =========================================================
   SET MANAGER
========================================================= */

function setManager() {
    if (!requireManager() || !state.managerUnlocked) {
        return;
    }

    const selected =
        document.getElementById(
            "managerSelect"
        ).value;

    if (!selected) {
        alert("Please select a manager.");
        return;
    }

    const phone =
        document.getElementById(
            "managerPhoneInput"
        ).value.trim();

    state.manager =
        selected;

    state.managerPhone =
        phone;

    state.managerRole =
        selected === state.user.name;

    state.managerUnlocked =
        false;

    log(
        "Manager changed to " +
        selected
    );

    save();

    renderAll();

    alert(
        "Manager updated. The new manager must unlock with the Manager PIN."
    );
}


/* =========================================================
   MEMBERS
========================================================= */

function manageMembers() {
    if (!requireManager() || !state.managerUnlocked) {
        return;
    }

    const name =
        prompt(
            "Enter new member name:"
        );

    if (!name) return;

    const cleanName =
        name.trim();

    if (!cleanName) return;

    if (state.members.includes(cleanName)) {
        alert(
            "This member already exists."
        );

        return;
    }

    const phone =
        prompt(
            "Enter member phone number:",
            ""
        ) || "";

    state.members.push(cleanName);

    state.memberPhones[cleanName] =
        phone.trim();

    log(
        "Added member: " +
        cleanName
    );

    save();

    renderManagerPanel();
    renderMemberInfoPage();
    renderMeals();
}

function removeMember(name) {
    if (!requireManager() || !state.managerUnlocked) {
        return;
    }

    if (state.user && name === state.user.name) {
        alert(
            "You cannot remove yourself."
        );

        return;
    }

    if (
        name === state.manager
    ) {
        alert(
            "Manager cannot be removed. Change the manager first."
        );

        return;
    }

    if (!confirm(
        "Remove " + name + "?"
    )) {
        return;
    }

    state.members =
        state.members.filter(function (x) {
            return x !== name;
        });

    delete state.memberPhones[name];

    /*
       Remove this member from every day's meal data
    */

    Object.keys(state.meals || {})
        .forEach(function (dateKey) {

            if (
                state.meals[dateKey] &&
                typeof state.meals[dateKey] === "object"
            ) {
                delete state.meals[dateKey][name];
            }
        });

    log(
        "Removed member: " +
        name
    );

    save();

    renderManagerPanel();
    renderMemberInfoPage();
    renderMeals();
}


/* =========================================================
   SAVE MANAGER CHANGES
========================================================= */

function saveManagerChanges() {
    if (!requireManager() || !state.managerUnlocked) {
        return;
    }

    const t1 =
        document.getElementById(
            "meal1CutoffInput"
        ).value;

    const t2 =
        document.getElementById(
            "meal2CutoffInput"
        ).value;

    if (!t1 || !t2) {
        alert(
            "Meal 1 and Meal 2 time দুটোই দিন।"
        );

        return;
    }

    state.mealTimes = {
        meal1: t1,
        meal2: t2
    };

    save();

    renderAll();

    alert(
        "Manager changes saved successfully."
    );
}


/* =========================================================
   MEMBER INFO
========================================================= */

function openMemberInfoPage() {
    if (!requireManager() || !state.managerUnlocked) {
        return;
    }

    document
        .querySelectorAll(".page")
        .forEach(function (x) {
            x.classList.remove("active");
        });

    document
        .getElementById("memberInfoPage")
        .classList.add("active");

    renderMemberInfoPage();
}

function closeMemberInfoPage() {
    document
        .getElementById("memberInfoPage")
        .classList.remove("active");

    document
        .getElementById("managerPanel")
        .classList.add("active");

    renderManagerPanel();
}

function renderMemberInfoPage() {
    const body =
        document.getElementById(
            "memberInfoTableBody"
        );

    if (!body) return;

    const members =
        state.members || [];

    body.innerHTML =
        members.length

            ? members.map(function (name) {

                const phone =
                    state.manager === name
                        ? (
                            state.managerPhone ||
                            (
                                state.user?.name === name
                                    ? state.user.phone
                                    : ""
                            )
                        )
                        : (
                            state.memberPhones?.[name] ||
                            (
                                state.user?.name === name
                                    ? state.user.phone
                                    : ""
                            )
                        );

                const action =
                    name === state.manager

                        ? '<span class="locked">Manager</span>'

                        : `
                            <button
                                class="member-remove-btn"
                                onclick="removeMember('${escapeJs(name)}')">
                                Remove
                            </button>
                        `;

                return `
                    <tr>

                        <td>
                            <b>
                                ${escapeHtml(name)}
                            </b>
                        </td>

                        <td class="member-phone">
                            ${escapeHtml(phone || "Not added")}
                        </td>

                        <td>
                            ${action}
                        </td>

                    </tr>
                `;

            }).join("")

            : `
                <tr>
                    <td colspan="3" class="locked">
                        No members added yet.
                    </td>
                </tr>
            `;
}


/* =========================================================
   MANAGER NOTIFICATION
========================================================= */

function sendManagerNotification() {
    if (!requireManager() || !state.managerUnlocked) {
        return;
    }

    const input =
        document.getElementById(
            "managerNotice"
        );

    if (!input) return;

    const text =
        input.value.trim();

    if (!text) {
        alert(
            "Write a notification first."
        );

        return;
    }

    state.notices.unshift({
        id: generateId(),
        ts: Date.now(),
        text: text,
        date: new Date().toLocaleString(),
        by: state.user.name
    });

    log(
        "Manager sent notification: " +
        text
    );

    input.value = "";

    save();

    renderNotices();

    alert(
        "Notification sent."
    );
}


/* =========================================================
   SETTINGS
========================================================= */

let editingSetting = null;

function editSetting(type) {
    if (!state.user) {
        return;
    }

    const labels = {

        name: [
            "Name",
            "text",
            state.user.name || ""
        ],

        phone: [
            "Phone Number",
            "tel",
            state.user.phone || ""
        ],

        birthday: [
            "Birthday",
            "date",
            state.user.birthday || ""
        ],

        email: [
            "Gmail",
            "email",
            state.user.email || ""
        ]
    };

    const item =
        labels[type];

    if (!item) return;

    const key =
        type.charAt(0).toUpperCase() +
        type.slice(1);

    const editor =
        document.getElementById(
            "settingEditor" + key
        );

    if (!editor) return;

    [
        "Name",
        "Phone",
        "Birthday",
        "Email"
    ].forEach(function (x) {

        if (x !== key) {

            const other =
                document.getElementById(
                    "settingEditor" + x
                );

            if (other) {
                other.classList.add("hidden");
                other.innerHTML = "";
            }
        }
    });

    editingSetting =
        type;

    editor.innerHTML = `
        <div class="editor-inner">

            <label>
                ${item[0]}
            </label>

            <input
                id="inlineSettingInput"
                type="${item[1]}"
                value="${escapeHtml(item[2])}">

            <div class="editor-actions">

                <button
                    class="cancel-edit"
                    onclick="cancelSettingEdit('${type}')">
                    Cancel
                </button>

                <button
                    class="save-edit"
                    onclick="saveSetting()">
                    Save
                </button>

            </div>

        </div>
    `;

    editor.classList.remove("hidden");

    document
        .getElementById("inlineSettingInput")
        .focus();
}

function cancelSettingEdit(type) {
    const key =
        type.charAt(0).toUpperCase() +
        type.slice(1);

    const editor =
        document.getElementById(
            "settingEditor" + key
        );

    if (editor) {
        editor.classList.add("hidden");
        editor.innerHTML = "";
    }

    editingSetting = null;
}

function saveStandaloneSetting() {
    saveSetting();
}

function saveSetting() {
    if (!editingSetting) {
        return;
    }

    const input =
        document.getElementById(
            "inlineSettingInput"
        );

    if (!input) return;

    const value =
        input.value.trim();

    if (!value) {
        alert(
            "Please enter a value."
        );

        return;
    }

    if (editingSetting === "name") {

        const oldName =
            state.user.name;

        state.user.name =
            value;

        if (state.manager === oldName) {
            state.manager =
                value;
        }

        state.members =
            state.members.map(function (m) {
                return m === oldName
                    ? value
                    : m;
            });

        if (
            state.memberPhones[oldName] !== undefined
        ) {
            state.memberPhones[value] =
                state.memberPhones[oldName];

            delete state.memberPhones[oldName];
        }

        /*
           Rename meal records
        */

        Object.keys(state.meals || {})
            .forEach(function (dateKey) {

                const day =
                    state.meals[dateKey];

                if (
                    day &&
                    day[oldName]
                ) {
                    day[value] =
                        day[oldName];

                    delete day[oldName];
                }
            });

    } else if (editingSetting === "phone") {

        state.user.phone =
            value;

        state.memberPhones[state.user.name] =
            value;

        if (state.manager === state.user.name) {
            state.managerPhone =
                value;
        }

    } else if (editingSetting === "birthday") {

        state.user.birthday =
            value;

    } else if (editingSetting === "email") {

        if (!/^\S+@gmail\.com$/i.test(value)) {
            alert(
                "Please enter a valid Gmail address."
            );

            return;
        }

        state.user.email =
            value.toLowerCase();
    }

    const edited =
        editingSetting;

    log(
        "Updated " +
        edited
    );

    save();

    cancelSettingEdit(edited);

    renderAll();

    alert(
        "Updated successfully."
    );
}


/* =========================================================
   SETTINGS PAGE
========================================================= */

function openSettingsInsideProfile() {
    // Opening Settings must never collapse the sidebar.
    const sidebar = document.getElementById("appSidebar");
    if (sidebar) {
        sidebar.classList.add("profile-open");
        updateSidebarCurrentWidth();
    }

    closeModal("profileModal");

    document
        .getElementById("settingsPage")
        .classList.add("open");

    const privacy =
        document.getElementById(
            "privacySelect"
        );

    if (privacy) {
        privacy.value =
            state.privacy || "private";
    }
}

function savePrivacySetting(value) {
    if (
        ![
            "private",
            "members",
            "public"
        ].includes(value)
    ) {
        return;
    }

    state.privacy =
        value;

    log(
        "Privacy changed to " +
        value
    );

    save();
}

function closeSettingsPage() {
    document
        .getElementById("settingsPage")
        .classList.remove("open");

    // Keep the sidebar expanded after Settings is closed.
    const sidebar = document.getElementById("appSidebar");
    if (sidebar) {
        sidebar.classList.add("profile-open");
        updateSidebarCurrentWidth();
    }

    const editor =
        document.getElementById(
            "standaloneSettingEditor"
        );

    if (editor) {
        editor.classList.add("hidden");
    }
}


/* =========================================================
   HISTORY PAGE
========================================================= */

function openHistoryInsideProfile() {
    // Opening History must never collapse the sidebar.
    const sidebar = document.getElementById("appSidebar");
    if (sidebar) {
        sidebar.classList.add("profile-open");
        updateSidebarCurrentWidth();
    }

    closeModal("profileModal");

    renderStandaloneHistory();

    document
        .getElementById("historyPage")
        .classList.add("open");
}

function closeHistoryPage() {
    document
        .getElementById("historyPage")
        .classList.remove("open");

    // Keep the sidebar expanded after History is closed.
    const sidebar = document.getElementById("appSidebar");
    if (sidebar) {
        sidebar.classList.add("profile-open");
        updateSidebarCurrentWidth();
    }
}

function renderStandaloneHistory() {
    const el =
        document.getElementById(
            "standaloneHistoryList"
        );

    if (!el) return;

    el.innerHTML =
        state.history.length

            ? state.history
                .map(function (h) {
                    return `
                        <div class="history-item">
                            ${escapeHtml(h.text)}
                            <br>
                            <small>
                                ${escapeHtml(h.date)}
                            </small>
                        </div>
                    `;
                })
                .join("")

            : '<p class="locked">No activity yet.</p>';
}


/* =========================================================
   INITIAL START
========================================================= */

if (
    state.user &&
    state.manager === state.user.name
) {
    state.managerRole = true;
    save();
}

/* =========================================================
   SESSION PERSISTENCE (refresh keeps you logged in,
   closing the tab/browser requires logging in again)
========================================================= */

/*
   Prevent a "flash of login page" while we wait to hear back from
   Firebase about whether there's an active session. Hide the login
   screen immediately; onAuthStateChanged below decides which
   screen to reveal once it actually knows the answer.
*/
const authScreenEl =
    document.getElementById("authScreen");

function showAuthFallback() {
    if (authScreenEl) {
        authScreenEl.classList.remove("hidden");
    }
    if (typeof showLogin === "function") {
        showLogin();
    }
}

if (typeof auth !== "undefined" && auth && typeof auth.setPersistence === "function") {
    auth.setPersistence(firebase.auth.Auth.Persistence.SESSION)
        .catch(function (err) {
            console.warn("Failed to set auth persistence:", err);
        });
}

if (typeof auth !== "undefined" && auth && typeof auth.onAuthStateChanged === "function") {

    if (authScreenEl) {
        authScreenEl.classList.add("hidden");
    }

    auth.onAuthStateChanged(async function (firebaseUser) {

        /*
           No active Firebase session (fresh visit, tab was closed,
           or user just logged out) -> reveal the login page now
           that we actually know it's the right screen to show.
        */
        if (!firebaseUser) {
            showAuthFallback();
            return;
        }

        /*
           Already loaded (e.g. right after login()/createAccount()
           already populated state.user, or this is a refresh and
           localStorage already has the right cached user data) ->
           no need to re-fetch from Firestore, but we still MUST
           call openApp() to reveal the home page instead of leaving
           the login screen showing.
        */
        if (state.user && state.user.uid === firebaseUser.uid) {
            await loadMessData();
            openApp();
            return;
        }

        try {
            if (typeof db !== "undefined" && db) {
                const userDoc =
                    await db.collection("users")
                        .doc(firebaseUser.uid)
                        .get();

                if (!userDoc.exists) {
                    showAuthFallback();
                    return;
                }

                const userData =
                    userDoc.data();

                if (userData.messCode) {
                    state.messCode = userData.messCode;
                    localStorage.setItem("messCode", userData.messCode);
                } else {
                    console.error(
                        "Session restore: user profile has no messCode."
                    );

                    alert(
                        "This account isn't linked to any mess yet. " +
                        "Please contact support or create a new mess."
                    );

                    if (typeof auth !== "undefined" && auth && typeof auth.signOut === "function") {
                        auth.signOut();
                    }

                    showAuthFallback();
                    return;
                }

                state.user = {
                    uid: firebaseUser.uid,
                    name: userData.name || "",
                    phone: userData.phone || "",
                    email: userData.email || "",
                    birthday: userData.birthday || "",
                    photo: userData.photo || null
                };

                await loadMessData();

                console.log("SESSION RESTORED");

                if (!state.members.includes(state.user.name)) {
                    state.members.unshift(state.user.name);
                }

                state.memberPhones[state.user.name] =
                    state.user.phone;

                save();

                openApp();
            } else {
                showAuthFallback();
            }

        } catch (err) {

            console.error("Failed to restore session on refresh:", err);
            showAuthFallback();
        }
    });

} else {

    /*
       Firebase auth isn't available at all -> fall back to
       showing the login screen immediately rather than leaving it hidden.
    */
    showAuthFallback();
}

/* =========================================================
   SIDEBAR EVENT LISTENERS INITIALIZATION
========================================================= */
document.addEventListener("DOMContentLoaded", function () {
    const sidebar = document.getElementById("appSidebar");
    const profileTrigger = sidebar ? sidebar.querySelector(".sidebar-profile") : null;
    if (!sidebar || !profileTrigger) return;

    sidebar.classList.add("collapsed");
    sidebar.setAttribute("aria-expanded", "false");

    profileTrigger.addEventListener("click", function (event) {
        if (typeof toggleSidebar === "function") toggleSidebar();
        event.stopPropagation();
    });

    sidebar.querySelectorAll(".sidebar-nav button").forEach(function (button) {
        button.addEventListener("click", function (event) {
            event.stopPropagation();
        });
    });

    sidebar.querySelectorAll(".sidebar-expanded-actions button").forEach(function (button) {
        button.addEventListener("click", function (event) {
            event.stopPropagation();
        });
    });

    const editButton = sidebar.querySelector(".sidebar-avatar-edit");
    if (editButton) {
        editButton.addEventListener("click", function (event) {
            event.stopPropagation();
        });
    }

    sidebar.querySelectorAll(".sidebar-pill").forEach(function (pill) {
        pill.addEventListener("click", function (event) {
            event.stopPropagation();
        });
    });
});

/* =========================================================
   PWA SERVICE WORKER REGISTRATION
========================================================= */
if ("serviceWorker" in navigator && (window.location.protocol === "https:" || window.location.hostname === "localhost")) {
    window.addEventListener("load", function () {
        navigator.serviceWorker.register("./sw.js").then(function (reg) {
            console.log("Hisab PWA Service Worker registered with scope:", reg.scope);
        }).catch(function (err) {
            console.log("Service Worker registration optional:", err);
        });
    });
}


/* =========================================================
   FEATURE 1: QUICK ACTIONS - 1-Click Meal Toggle + Countdown
========================================================= */

function quickToggleMeal(mealNum, isOn) {
    if (!state.user) return;
    var today = new Date().toISOString().slice(0, 10);
    if (!state.meals[today]) state.meals[today] = {};
    var userName = state.user.name || state.members[0];
    if (!state.meals[today][userName]) state.meals[today][userName] = { meal1: 0, meal2: 0 };

    // Check cutoff time
    var now = new Date();
    var cutoffKey = "meal" + mealNum;
    var cutoffTime = state.mealTimes ? state.mealTimes[cutoffKey] : null;
    if (cutoffTime && !state.managerUnlocked) {
        var parts = cutoffTime.split(":");
        var cutoff = new Date();
        cutoff.setHours(parseInt(parts[0]), parseInt(parts[1]), 0, 0);
        if (now > cutoff) {
            alert("⏰ সময় শেষ! " + (mealNum === 1 ? "দুপুরের" : "রাতের") + " মিল পরিবর্তনের সময় " + cutoffTime + " এ শেষ হয়ে গেছে।");
            document.getElementById("qaMeal" + mealNum + "Toggle").checked = !isOn;
            return;
        }
    }

    state.meals[today][userName]["meal" + mealNum] = isOn ? 1 : 0;
    save();
    updateQuickActionUI();
    if (typeof renderMeals === "function") renderMeals();
    log(userName + " meal " + mealNum + " → " + (isOn ? "ON" : "OFF"));
}

function updateQuickActionUI() {
    var today = new Date().toISOString().slice(0, 10);
    var userName = (state.user && state.user.name) ? state.user.name : (state.members && state.members[0] ? state.members[0] : "");
    var todayMeals = (state.meals[today] && state.meals[today][userName]) ? state.meals[today][userName] : { meal1: 0, meal2: 0 };

    var t1 = document.getElementById("qaMeal1Toggle");
    var t2 = document.getElementById("qaMeal2Toggle");
    var s1 = document.getElementById("qaMeal1Status");
    var s2 = document.getElementById("qaMeal2Status");

    if (t1) t1.checked = !!todayMeals.meal1;
    if (t2) t2.checked = !!todayMeals.meal2;
    if (s1) s1.textContent = todayMeals.meal1 ? "ON ✅" : "OFF ❌";
    if (s2) s2.textContent = todayMeals.meal2 ? "ON ✅" : "OFF ❌";
    if (s1) s1.className = "qa-status " + (todayMeals.meal1 ? "qa-on" : "qa-off");
    if (s2) s2.className = "qa-status " + (todayMeals.meal2 ? "qa-on" : "qa-off");

    // Bazaar duty
    var bazaarName = document.getElementById("qaBazaarName");
    if (bazaarName) {
        bazaarName.textContent = (state.bazaarDuty) ? state.bazaarDuty : "সেট করা হয়নি";
    }
}

function updateMealCountdowns() {
    if (!state.mealTimes) return;
    var now = new Date();

    [1, 2].forEach(function(m) {
        var el = document.getElementById("qaMeal" + m + "Countdown");
        if (!el) return;
        var cutoff = state.mealTimes["meal" + m];
        if (!cutoff) { el.textContent = ""; return; }
        var parts = cutoff.split(":");
        var target = new Date();
        target.setHours(parseInt(parts[0]), parseInt(parts[1]), 0, 0);
        var diff = target - now;
        if (diff <= 0) {
            el.textContent = "⏰ সময় শেষ!";
            el.className = "qa-countdown qa-expired";
        } else {
            var hrs = Math.floor(diff / 3600000);
            var mins = Math.floor((diff % 3600000) / 60000);
            el.textContent = "⏳ বাকি " + (hrs > 0 ? hrs + "ঘ " : "") + mins + "মি";
            el.className = "qa-countdown" + (diff < 1800000 ? " qa-urgent" : "");
        }
    });
}

setInterval(updateMealCountdowns, 30000);

/* =========================================================
   FEATURE 2: BOTTOM NAVIGATION BAR
========================================================= */

function activateBottomNav(btn) {
    if (!btn) return;
    var nav = document.getElementById("bottomNav");
    if (!nav) return;
    nav.querySelectorAll(".bnav-btn").forEach(function(b) { b.classList.remove("active"); });
    btn.classList.add("active");
}

function showBottomNav() {
    var nav = document.getElementById("bottomNav");
    if (nav) nav.classList.remove("hidden");
}

function hideBottomNav() {
    var nav = document.getElementById("bottomNav");
    if (nav) nav.classList.add("hidden");
}

/* =========================================================
   FEATURE 3: bKash/Nagad Payment System
========================================================= */

if (!state.paymentSettings) {
    state.paymentSettings = { bkash: "", nagad: "" };
}
if (!state.paymentRequests) {
    state.paymentRequests = [];
}
if (!state.bazaarDuty) {
    state.bazaarDuty = "";
}

function openPaymentModal() {
    document.getElementById("paymentModal").classList.remove("hidden");
    updatePaymentUI();
    renderPaymentRequests();
}

function closePaymentModal() {
    document.getElementById("paymentModal").classList.add("hidden");
}

var currentPayTab = "bkash";

function switchPayTab(tab, btn) {
    currentPayTab = tab;
    document.querySelectorAll(".pay-tab").forEach(function(t) { t.classList.remove("active"); });
    if (btn) btn.classList.add("active");
    updatePaymentUI();
}

function updatePaymentUI() {
    var icon = document.getElementById("payServiceIcon");
    var num = document.getElementById("payNumber");
    if (currentPayTab === "bkash") {
        if (icon) icon.textContent = "🟪";
        if (num) num.textContent = (state.paymentSettings && state.paymentSettings.bkash) ? state.paymentSettings.bkash : "সেট করা হয়নি";
    } else {
        if (icon) icon.textContent = "🟧";
        if (num) num.textContent = (state.paymentSettings && state.paymentSettings.nagad) ? state.paymentSettings.nagad : "সেট করা হয়নি";
    }
}

function copyPaymentNumber() {
    var num = (currentPayTab === "bkash") ? (state.paymentSettings.bkash || "") : (state.paymentSettings.nagad || "");
    if (!num) { alert("নম্বর সেট করা হয়নি!"); return; }
    navigator.clipboard.writeText(num).then(function() {
        alert("✅ নম্বর কপি হয়েছে: " + num);
    }).catch(function() {
        prompt("নম্বর কপি করুন:", num);
    });
}

function submitPaymentRequest() {
    var trxId = document.getElementById("payTrxId").value.trim();
    var amount = parseFloat(document.getElementById("payAmount").value);
    if (!trxId || !amount || amount <= 0) {
        alert("TrxID এবং টাকার পরিমাণ দিন!");
        return;
    }
    var req = {
        id: Date.now(),
        member: (state.user && state.user.name) ? state.user.name : "Unknown",
        trxId: trxId,
        amount: amount,
        service: currentPayTab,
        date: new Date().toLocaleString("bn-BD"),
        status: "pending"
    };
    state.paymentRequests.push(req);
    save();
    document.getElementById("payTrxId").value = "";
    document.getElementById("payAmount").value = "";
    alert("✅ জমার রিকোয়েস্ট পাঠানো হয়েছে! ম্যানেজার Approve করলে ব্যালেন্সে যুক্ত হবে।");
    renderPaymentRequests();
    log(req.member + " payment request ৳" + amount + " via " + currentPayTab + " (TrxID: " + trxId + ")");
}

function renderPaymentRequests() {
    var el = document.getElementById("paymentRequestsList");
    if (!el) return;
    var pending = (state.paymentRequests || []).filter(function(r) { return r.status === "pending"; });
    if (pending.length === 0) {
        el.innerHTML = "";
        return;
    }
    el.innerHTML = "<div class='pay-req-title'>📋 পেন্ডিং রিকোয়েস্ট (" + pending.length + ")</div>" +
        pending.map(function(r) {
            return "<div class='pay-req-item'>" +
                "<div class='pay-req-info'><strong>" + r.member + "</strong> — ৳" + r.amount + " (" + r.service + ")<br><small>TrxID: " + r.trxId + " | " + r.date + "</small></div>" +
                (state.managerUnlocked ? "<button class='pay-approve-btn' onclick='approvePayment(" + r.id + ")'>✓ Approve</button>" : "<span class='pay-pending-badge'>⏳ Pending</span>") +
                "</div>";
        }).join("");
}

function approvePayment(id) {
    var req = (state.paymentRequests || []).find(function(r) { return r.id === id; });
    if (!req) return;
    req.status = "approved";
    // Add as income entry
    state.entries.push({
        type: "income",
        member: req.member,
        desc: req.service + " জমা (TrxID: " + req.trxId + ")",
        amount: req.amount,
        date: new Date().toISOString()
    });
    save();
    if (typeof renderAccounts === "function") renderAccounts();
    renderPaymentRequests();
    alert("✅ " + req.member + " এর ৳" + req.amount + " জমা Approve হয়েছে!");
    log("Payment approved: " + req.member + " ৳" + req.amount);
}

function savePaymentSettings() {
    var bkash = document.getElementById("bkashNumberInput").value.trim();
    var nagad = document.getElementById("nagadNumberInput").value.trim();
    var bazaarSelect = document.getElementById("bazaarDutySelect");
    state.paymentSettings = { bkash: bkash, nagad: nagad };
    if (bazaarSelect) state.bazaarDuty = bazaarSelect.value;
    save();
    alert("✅ পেমেন্ট সেটিংস সেভ হয়েছে!");
    updateQuickActionUI();
}

function checkLowBalance() {
    var alertEl = document.getElementById("lowBalanceAlert");
    if (!alertEl) return;
    if (!state.user || !state.user.name) { alertEl.classList.add("hidden"); return; }

    var totalIncome = 0, totalMealCost = 0;
    var mealRate = 0;
    var totalExpense = 0, totalMeals = 0;

    (state.entries || []).forEach(function(e) {
        if (e.type === "expense") totalExpense += (e.amount || 0);
    });

    Object.values(state.meals || {}).forEach(function(day) {
        Object.values(day).forEach(function(m) {
            totalMeals += (m.meal1 || 0) + (m.meal2 || 0);
        });
    });

    if (totalMeals > 0) mealRate = totalExpense / totalMeals;

    var myMeals = 0;
    Object.values(state.meals || {}).forEach(function(day) {
        if (day[state.user.name]) {
            myMeals += (day[state.user.name].meal1 || 0) + (day[state.user.name].meal2 || 0);
        }
    });
    totalMealCost = myMeals * mealRate;

    (state.entries || []).forEach(function(e) {
        if (e.type === "income" && e.member === state.user.name) totalIncome += (e.amount || 0);
    });

    var balance = totalIncome - totalMealCost;
    if (balance < 0) {
        alertEl.classList.remove("hidden");
    } else {
        alertEl.classList.add("hidden");
    }
}

/* =========================================================
   FEATURE 4: WhatsApp Share
========================================================= */

function shareToWhatsApp(type) {
    var text = "";
    var today = new Date().toLocaleDateString("bn-BD", { year: "numeric", month: "long", day: "numeric" });

    if (type === "daily") {
        var todayKey = new Date().toISOString().slice(0, 10);
        var dayMeals = state.meals[todayKey] || {};
        var totalM1 = 0, totalM2 = 0;
        Object.values(dayMeals).forEach(function(m) {
            totalM1 += (m.meal1 || 0);
            totalM2 += (m.meal2 || 0);
        });

        text = "📋 *হিসাব — আজকের রিপোর্ট*\n";
        text += "📅 " + today + "\n\n";
        text += "☀️ দুপুর (Meal 1): " + totalM1 + " জন\n";
        text += "🌙 রাত (Meal 2): " + totalM2 + " জন\n";
        text += "📊 মোট মিল: " + (totalM1 + totalM2) + "\n";
        if (state.bazaarDuty) text += "🛒 আজকের বাজার: " + state.bazaarDuty + "\n";
        text += "\n— হিসাব অ্যাপ 📖";
    } else {
        var totalIncome = 0, totalExpense = 0, totalMeals = 0;
        (state.entries || []).forEach(function(e) {
            if (e.type === "income") totalIncome += (e.amount || 0);
            if (e.type === "expense") totalExpense += (e.amount || 0);
        });
        Object.values(state.meals || {}).forEach(function(day) {
            Object.values(day).forEach(function(m) {
                totalMeals += (m.meal1 || 0) + (m.meal2 || 0);
            });
        });
        var mealRate = totalMeals > 0 ? (totalExpense / totalMeals).toFixed(2) : 0;

        text = "📊 *হিসাব — মাসিক রিপোর্ট*\n";
        text += "📅 " + today + "\n\n";
        text += "👥 মোট মেম্বার: " + state.members.length + "\n";
        text += "🍽️ মোট মিল: " + totalMeals + "\n";
        text += "💰 মোট জমা: ৳" + totalIncome + "\n";
        text += "🧾 মোট খরচ: ৳" + totalExpense + "\n";
        text += "⚖️ ব্যালেন্স: ৳" + (totalIncome - totalExpense) + "\n";
        text += "📈 মিল রেট: ৳" + mealRate + "\n";
        text += "\n— হিসাব অ্যাপ 📖";
    }

    var url = "https://wa.me/?text=" + encodeURIComponent(text);

    if (navigator.share) {
        navigator.share({ title: "হিসাব রিপোর্ট", text: text }).catch(function() {
            window.open(url, "_blank");
        });
    } else {
        window.open(url, "_blank");
    }
}

/* =========================================================
   FEATURE 5: Meal Rate Transparency
========================================================= */

function updateMealRateCard() {
    var totalExpense = 0, totalMeals = 0;
    (state.entries || []).forEach(function(e) {
        if (e.type === "expense") totalExpense += (e.amount || 0);
    });
    Object.values(state.meals || {}).forEach(function(day) {
        Object.values(day).forEach(function(m) {
            totalMeals += (m.meal1 || 0) + (m.meal2 || 0);
        });
    });
    var rate = totalMeals > 0 ? totalExpense / totalMeals : 0;

    var el1 = document.getElementById("mrfTotalExpense");
    var el2 = document.getElementById("mrfTotalMeals");
    var el3 = document.getElementById("mrfRate");
    if (el1) el1.textContent = "৳" + totalExpense;
    if (el2) el2.textContent = totalMeals;
    if (el3) el3.textContent = "৳" + rate.toFixed(2);

    // My breakdown
    if (state.user && state.user.name) {
        var myMeals = 0, myDeposit = 0;
        Object.values(state.meals || {}).forEach(function(day) {
            if (day[state.user.name]) {
                myMeals += (day[state.user.name].meal1 || 0) + (day[state.user.name].meal2 || 0);
            }
        });
        (state.entries || []).forEach(function(e) {
            if (e.type === "income" && e.member === state.user.name) myDeposit += (e.amount || 0);
        });
        var myCost = myMeals * rate;
        var myBal = myDeposit - myCost;

        var e1 = document.getElementById("myDeposit");
        var e2 = document.getElementById("myTotalMeals");
        var e3 = document.getElementById("myMealCost");
        var e4 = document.getElementById("myBalance");
        if (e1) e1.textContent = "৳" + myDeposit;
        if (e2) e2.textContent = myMeals;
        if (e3) e3.textContent = "৳" + myCost.toFixed(2);
        if (e4) {
            e4.textContent = "৳" + myBal.toFixed(2);
            e4.className = myBal >= 0 ? "income" : "expense";
        }
    }
}

function toggleMyBreakdown() {
    var el = document.getElementById("myBalDetails");
    var arrow = document.getElementById("myBalArrow");
    if (el) el.classList.toggle("hidden");
    if (arrow) arrow.textContent = el && el.classList.contains("hidden") ? "▼" : "▲";
}

/* =========================================================
   FEATURE 6: PWA Install Prompt
========================================================= */

var deferredPWAPrompt = null;

window.addEventListener("beforeinstallprompt", function(e) {
    e.preventDefault();
    deferredPWAPrompt = e;
    var banner = document.getElementById("pwaInstallBanner");
    if (banner && !localStorage.getItem("pwa_dismissed")) {
        banner.classList.remove("hidden");
    }
});

function installPWA() {
    if (!deferredPWAPrompt) return;
    deferredPWAPrompt.prompt();
    deferredPWAPrompt.userChoice.then(function(result) {
        if (result.outcome === "accepted") {
            console.log("PWA installed!");
        }
        deferredPWAPrompt = null;
        var banner = document.getElementById("pwaInstallBanner");
        if (banner) banner.classList.add("hidden");
    });
}

function dismissPWABanner() {
    var banner = document.getElementById("pwaInstallBanner");
    if (banner) banner.classList.add("hidden");
    localStorage.setItem("pwa_dismissed", "1");
}

/* =========================================================
   FEATURE 7: Voice Input for Bazaar
========================================================= */

var voiceRecognition = null;
var isRecording = false;

function openVoiceModal() {
    document.getElementById("voiceInputModal").classList.remove("hidden");
    document.getElementById("voiceText").value = "";
    document.getElementById("voiceResult").textContent = "";
    document.getElementById("voiceStatus").textContent = "মাইক্রোফোনে ক্লিক করে বলুন...";
    var micBtn = document.getElementById("voiceMicBtn");
    if (micBtn) micBtn.classList.remove("recording");
}

function closeVoiceModal() {
    document.getElementById("voiceInputModal").classList.add("hidden");
    stopVoiceRecording();
}

function toggleVoiceRecording() {
    if (isRecording) {
        stopVoiceRecording();
    } else {
        startVoiceRecording();
    }
}

function startVoiceRecording() {
    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert("❌ আপনার ব্রাউজার ভয়েস ইনপুট সাপোর্ট করে না। Chrome ব্রাউজার ব্যবহার করুন।");
        return;
    }
    voiceRecognition = new SpeechRecognition();
    voiceRecognition.lang = "bn-BD";
    voiceRecognition.continuous = true;
    voiceRecognition.interimResults = true;

    var finalText = document.getElementById("voiceText").value;

    voiceRecognition.onresult = function(event) {
        var interim = "";
        for (var i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
                finalText += event.results[i][0].transcript + "\n";
                document.getElementById("voiceText").value = finalText;
            } else {
                interim += event.results[i][0].transcript;
            }
        }
        document.getElementById("voiceResult").textContent = interim;
    };

    voiceRecognition.onstart = function() {
        isRecording = true;
        document.getElementById("voiceStatus").textContent = "🔴 শুনছি... বলুন!";
        var micBtn = document.getElementById("voiceMicBtn");
        if (micBtn) micBtn.classList.add("recording");
    };

    voiceRecognition.onend = function() {
        isRecording = false;
        document.getElementById("voiceStatus").textContent = "✅ রেকর্ডিং শেষ।";
        var micBtn = document.getElementById("voiceMicBtn");
        if (micBtn) micBtn.classList.remove("recording");
    };

    voiceRecognition.onerror = function(event) {
        console.warn("Voice error:", event.error);
        document.getElementById("voiceStatus").textContent = "❌ সমস্যা হয়েছে: " + event.error;
        isRecording = false;
        var micBtn = document.getElementById("voiceMicBtn");
        if (micBtn) micBtn.classList.remove("recording");
    };

    voiceRecognition.start();
}

function stopVoiceRecording() {
    if (voiceRecognition) {
        voiceRecognition.stop();
        voiceRecognition = null;
    }
    isRecording = false;
}

function applyVoiceText() {
    var text = document.getElementById("voiceText").value.trim();
    if (!text) { alert("কিছু বলুন বা টাইপ করুন!"); return; }
    var descField = document.getElementById("entryDesc");
    if (descField) {
        descField.value = text;
    }
    closeVoiceModal();
    // Auto-open entry page if not already open
    if (typeof openEntryPage === "function") openEntryPage();
}

/* =========================================================
   FEATURE HOOKS — Wire features into existing app lifecycle
========================================================= */

// Override openApp to also show bottom nav and initialize features
var _originalOpenApp = typeof openApp === "function" ? openApp : null;
if (_originalOpenApp) {
    openApp = function() {
        _originalOpenApp.apply(this, arguments);
        showBottomNav();
        updateQuickActionUI();
        updateMealCountdowns();
        updateMealRateCard();
        checkLowBalance();
        populateBazaarDutySelect();
        loadPaymentSettingsUI();
    };
}

// Populate bazaar duty dropdown
function populateBazaarDutySelect() {
    var sel = document.getElementById("bazaarDutySelect");
    if (!sel) return;
    sel.innerHTML = "<option value=''>-- বাজার কার? --</option>";
    (state.members || []).forEach(function(m) {
        var opt = document.createElement("option");
        opt.value = m;
        opt.textContent = m;
        if (state.bazaarDuty === m) opt.selected = true;
        sel.appendChild(opt);
    });
}

function loadPaymentSettingsUI() {
    var bk = document.getElementById("bkashNumberInput");
    var ng = document.getElementById("nagadNumberInput");
    if (bk && state.paymentSettings) bk.value = state.paymentSettings.bkash || "";
    if (ng && state.paymentSettings) ng.value = state.paymentSettings.nagad || "";
}


/* =========================================================
   MOBILE DRAWER & RESPONSIVE NAVIGATION FIXES
========================================================= */

function toggleMobileDrawer() {
    var sidebar = document.getElementById("appSidebar");
    var backdrop = document.getElementById("mobileDrawerBackdrop");
    if (!sidebar) return;
    var isOpen = sidebar.classList.toggle("mobile-drawer-open");
    if (isOpen) {
        sidebar.classList.remove("collapsed");
        sidebar.classList.add("profile-open");
        if (backdrop) backdrop.classList.remove("hidden");
    } else {
        if (backdrop) backdrop.classList.add("hidden");
    }
}

function closeMobileDrawer() {
    var sidebar = document.getElementById("appSidebar");
    var backdrop = document.getElementById("mobileDrawerBackdrop");
    if (sidebar) sidebar.classList.remove("mobile-drawer-open");
    if (backdrop) backdrop.classList.add("hidden");
}

// Auto-close mobile drawer when clicking sidebar nav or action buttons on small screens
document.addEventListener("DOMContentLoaded", function () {
    var sidebar = document.getElementById("appSidebar");
    if (!sidebar) return;
    sidebar.querySelectorAll(".sidebar-nav button, .sidebar-expanded-actions button, .sidebar-logout-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
            if (window.innerWidth <= 768) {
                closeMobileDrawer();
            }
        });
    });
});

// Hook logout to also hide bottom nav & close mobile drawer
var _originalLogout = typeof logout === "function" ? logout : null;
if (_originalLogout) {
    logout = function () {
        closeMobileDrawer();
        hideBottomNav();
        return _originalLogout.apply(this, arguments);
    };
}
