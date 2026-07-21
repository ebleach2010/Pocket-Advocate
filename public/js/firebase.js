// Single import point for Firebase across the app.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signInWithCustomToken,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  arrayUnion,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {
  getStorage,
  ref,
  uploadBytesResumable,
  listAll,
  getDownloadURL,
  getMetadata,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js';
import {
  getDatabase,
  ref as rtdbRef,
  onValue,
  set as rtdbSet,
  onDisconnect,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const rtdb = getDatabase(app);
export {
  onAuthStateChanged,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signInWithCustomToken,
  signOut,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  arrayUnion,
  ref,
  uploadBytesResumable,
  listAll,
  getDownloadURL,
  getMetadata,
  rtdbRef,
  onValue,
  rtdbSet,
  onDisconnect,
};
