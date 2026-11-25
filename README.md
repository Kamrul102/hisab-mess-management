# 📖 Hisab (হিসাব) — Smart Mess Accounts & Meal Management System

[![PWA Ready](https://img.shields.io/badge/PWA-Ready-orange.svg)](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)
[![Firebase](https://img.shields.io/badge/Backend-Firebase%20Firestore-FFCA28?logo=firebase&logoColor=black)](https://firebase.google.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![JavaScript](https://img.shields.io/badge/Vanilla-JavaScript%20ES6+-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)

> **Hisab** হলো মেস এবং হোস্টেলের মিল, বাজার খরচ ও আর্থিক হিসাব পরিচালনার জন্য একটি সম্পূর্ণ রিয়েল-টাইম ওয়েব অ্যাপ্লিকেশন (PWA)। এতে কোনো সাইন-আপ ছাড়াই পরীক্ষা করার জন্য অন্তর্নির্মিত **Interactive Live Demo Mode** রয়েছে।

---

## 🌟 প্রধান সুবিধাসমূহ (Key Features)

* **🚀 1-Click Live Demo Mode:** কোনো একাউন্ট বা ব্যাকএন্ড কনফিগারেশন ছাড়াই যে কেউ সরাসরি ডেমো মোডে অ্যাপের সব ফিচার টেস্ট করতে পারবে।
* **🔄 Real-time Live Synchronization:** Cloud Firestore-এর মাধ্যমে পেজ রিফ্রেশ ছাড়াই সাথে সাথে সবার স্ক্রিনে মিল ও হিসাবের লাইভ আপডেট।
* **🔒 Cryptographic Security:** ম্যানেজার পিন কোড ক্লায়েন্ট-সাইডে Salted SHA-256 হ্যাশ দ্বারা সুরক্ষিত এবং সার্ভারে প্রোডাকশন-গ্রেড সিকিউরিটি রুলস।
* **📊 Visual Analytics (Chart.js):** খরচের ক্যাটাগরি (বাজার, ইউটিলিটি, অন্যান্য) ও বর্তমান মেস ব্যালেন্সের আধুনিক ডোনাট চার্ট ড্যাশবোর্ড।
* **📥 1-Click Excel/CSV Export:** সম্পূর্ণ মেসের আয়-ব্যয়ের তালিকা সরাসরি স্প্রেডশিট (`.csv`) ফাইলে ডাউনলোড।
* **🖨️ Printable Statements:** এক ক্লিকে মেসের মাসিক হিসাবের পরিষ্কার প্রিন্ট প্রিভিউ ও PDF তৈরি।
* **📱 Progressive Web App (PWA):** যেকোনো অ্যান্ড্রয়েড বা আইফোনে কোনো অ্যাপ স্টোর ছাড়াই সাধারণ অ্যাপের মতো ইন্সটলযোগ্য।
* **🌐 দ্বিভাষিক সাপোর্ট (Bilingual):** বাংলা এবং ইংরেজি উভয় ভাষায় সম্পূর্ণ ইন্টারফেস পরিবর্তন।

---

## 🛠️ প্রযুক্তি (Tech Stack)

| স্তর | প্রযুক্তি |
| :--- | :--- |
| **Frontend** | Semantic HTML5, Modern Responsive CSS3, Vanilla JavaScript (ES6+) |
| **Backend / Database** | Firebase Authentication, Cloud Firestore (Real-time DB) |
| **Data Analytics** | Chart.js |
| **Offline & Mobile** | Service Workers, Web App Manifest (PWA) |
| **Security** | Cloud Firestore Security Rules, Web Crypto API (SHA-256) |

---

## 🚀 লোকাল সেটআপ ও রান করার নিয়ম (Getting Started)

### ১. রিপোজিটরিটি ক্লোন করুন:
```bash
git clone https://github.com/<your-username>/hisab-mess-management.git
cd hisab-mess-management
```

### ২. কনফিগারেশন সেটআপ করুন:
`firebase-config.example.js` ফাইলটি কপি করে `firebase-config.js` নামে রিনেম করুন এবং আপনার নিজস্ব Firebase কী বসিয়ে দিন:
```bash
cp firebase-config.example.js firebase-config.js
```

### ৩. অ্যাপ রান করুন:
সরাসরি ব্রাউজারে `index.html` ফাইলটি ডাবল ক্লিক করে ওপেন করুন অথবা VS Code Live Server এক্সটেনশন দিয়ে রান করুন।

---

## 🔒 সিকিউরিটি রুলস ডিপ্লয় (Firebase CLI)

```bash
firebase deploy --only firestore:rules
```

---

## 📄 License
This project is open-source under the [MIT License](LICENSE).
