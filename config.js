// إعدادات التطبيق — الصق بيانات Firebase هنا (من Project settings > Your apps > Web)
window.APP_CONFIG = {
  firebase: {
    apiKey: "AIzaSyAQ2WAF6GDxVHsP5dllzFN_oGAiQUVSTr8",
    authDomain: "banaeem-orders.firebaseapp.com",
    projectId: "banaeem-orders",
    storageBucket: "banaeem-orders.firebasestorage.app",
    messagingSenderId: "1095877420247",
    appId: "1:1095877420247:web:70f55907ffbc77bb103c92"
  },
  // نطاق وهمي للدخول: اسم المستخدم "store" = store@banaeem.app في Firebase
  domain: "banaeem.app",
  // المستخدمين وأدوارهم (owner = المدير، store = المستودع، entry = مدخل البيانات)
  users: {
    admin: { name: "لطف",          role: "owner" },
    store: { name: "المستودع",      role: "store" },
    entry: { name: "مدخل البيانات", role: "entry" }
  }
};
