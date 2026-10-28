require("dotenv").config();
const express = require("express");
const path = require("path");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const fs = require("fs");
const app = express();
const PORT = process.env.PORT || 3000;

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const videosFile = path.join(__dirname, "videos.json");
if (!fs.existsSync(videosFile)) fs.writeFileSync(videosFile, "[]");

const subsFile = path.join(__dirname, "subscriptions.json");
if (!fs.existsSync(subsFile)) fs.writeFileSync(subsFile, "[]");

const pendingFile = path.join(__dirname, "pending.json");
if (!fs.existsSync(pendingFile)) fs.writeFileSync(pendingFile, "[]");

function getVideos(){ try{return JSON.parse(fs.readFileSync(videosFile,"utf8"));}catch(e){return [];} }
function saveVideos(v){ fs.writeFileSync(videosFile, JSON.stringify(v,null,2)); }
function getSubs(){ try{return JSON.parse(fs.readFileSync(subsFile,"utf8"));}catch(e){return [];} }
function saveSubs(s){ fs.writeFileSync(subsFile, JSON.stringify(s,null,2)); }
function getPending(){ try{return JSON.parse(fs.readFileSync(pendingFile,"utf8"));}catch(e){return [];} }
function savePending(p){ fs.writeFileSync(pendingFile, JSON.stringify(p,null,2)); }

const storage = multer.diskStorage({destination:(a,b,c)=>c(null,uploadDir),filename:(a,b,c)=>c(null,Date.now()+"-"+b.originalname)});
const upload = multer({storage});

app.use(express.urlencoded({extended:true}));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || "ponzi-videozone-secret-2024",
  resave:false,
  saveUninitialized:true,
  cookie: { maxAge: 1000*60*60*24*31 }
}));

function requireAdmin(req,res,next){ if(req.session.isAdmin) return next(); res.redirect("/login"); }

function hasActiveSub(req){
  if(req.session.isAdmin) return true;
  const subs = getSubs();
  const mySub = subs.find(s => s.sessionId === req.sessionID && new Date(s.expiresAt) > new Date());
  if(mySub) return true;
  if(req.session.customerSub && new Date(req.session.customerSub.expiresAt) > new Date()){
    return true;
  }
  return false;
}

app.get("/", (req,res)=>res.sendFile(path.join(__dirname,"index.html")));
app.get("/login", (req,res)=>res.sendFile(path.join(__dirname,"login.html")));
app.get("/admin", requireAdmin, (req,res)=>res.sendFile(path.join(__dirname,"admin.html")));

app.get("/api/my-subscription", (req,res)=>{
  const subs = getSubs();
  const mySub = subs.find(s => s.sessionId === req.sessionID && new Date(s.expiresAt) > new Date());
  const sessionSub = req.session.customerSub;
  let activeSub = mySub || (sessionSub && new Date(sessionSub.expiresAt) > new Date() ? sessionSub : null);
  if(activeSub){
    res.json({ active: true, plan: activeSub.plan, expiresAt: activeSub.expiresAt });
  } else {
    res.json({ active: false });
  }
});

app.get("/api/videos", (req,res)=>{
  if(!hasActiveSub(req)){
    return res.status(403).json({ error: "SUBSCRIPTION_REQUIRED", message: "Lipa kwanza kuangalia video" });
  }
  res.json(getVideos());
});

// STEP 1: MTEJA ANAWEKA NAMBA - TUNAMTUMIA MESEJI YA M-PESA (HAIFUNGUKI BADO)
app.post("/api/pay", (req,res)=>{
  const { plan, phone } = req.body;
  
  if(!plan || !phone){
    return res.status(400).json({ success:false, message: "Jaza namba yako ya M-Pesa" });
  }
  if(phone.length < 10){
    return res.status(400).json({ success:false, message: "Namba ya simu si sahihi" });
  }

  let days = 1;
  let amount = 500;
  let planName = "Siku 1";

  if(plan === "3days"){
    days = 3;
    amount = 1000;
    planName = "Siku 3";
  } else if(plan === "monthly"){
    days = 30;
    amount = 5000;
    planName = "Mwezi";
  }

  const pendingId = Date.now().toString();
  const pending = getPending();
  pending.push({
    id: pendingId,
    sessionId: req.sessionID,
    plan,
    planName,
    amount,
    days,
    phone,
    createdAt: new Date().toISOString(),
    status: 'pending'
  });
  savePending(pending);

  console.log(`\n--- M-PESA PUSH INATUMWA ---\nKwa: ${phone}\nKiasi: ${amount} TZS\nMpango: ${planName}\nID: ${pendingId}\n----------------------------\n`);

  // HAPA NDIPO AZAMPAY API ITAWEKWA BAADAYE KUTUMA PUSH YA KWELI
  // const azamRes = await fetch('https://api.azampay.com/azampay/mno/checkout', { ... })

  res.json({ 
    success: true,
    pendingId: pendingId,
    message: `Tumekutumia meseji ya M-Pesa kwenye ${phone}. Kiasi: TSh ${amount}. Fungua simu yako, utaona meseji ya M-Pesa inaomba uweke PIN yako kuthibitisha malipo ya VIDEO ZONE.`,
    amount,
    phone
  });
});

// STEP 2: MTEJA AKIBONYEZA "NIMELIPA" - NDIPO VIDEO ZINAFUNGUKA
app.post("/api/confirm-pay", (req,res)=>{
  const { pendingId } = req.body;
  const pending = getPending();
  const found = pending.find(p => p.id === pendingId && p.sessionId === req.sessionID);

  if(!found){
    return res.json({ success:false, message: "Malipo hayajapatikana, jaribu tena" });
  }

  // Hapa tunge-check kama M-Pesa imethibitisha: if(azamRes.status === 'SUCCESS')
  // Kwa sasa ni simulation

  const expiresAt = new Date(Date.now() + found.days*24*60*60*1000);
  
  const newSub = {
    id: Date.now(),
    sessionId: req.sessionID,
    plan: found.plan,
    planName: found.planName,
    amount: found.amount,
    phone: found.phone,
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString()
  };

  const subs = getSubs();
  const filtered = subs.filter(s => s.sessionId !== req.sessionID);
  filtered.push(newSub);
  saveSubs(filtered);
  req.session.customerSub = newSub;

  // Futa pending
  savePending(pending.filter(p => p.id !== pendingId));

  console.log(`✅ M-PESA IMETHIBITISHWA: ${found.planName} - ${found.amount} - ${found.phone}`);

  res.json({ 
    success: true, 
    message: `Hongera! Malipo ya TSh ${found.amount} kupitia M-Pesa yamepokelewa! Video zimefunguka!`,
    subscription: newSub
  });
});

app.post("/login", async (req,res)=>{
  const valid = await bcrypt.compare(req.body.password, process.env.ADMIN_PASSWORD_HASH);
  if(req.body.email!==process.env.ADMIN_EMAIL || !valid) return res.status(401).send("Login failed");
  req.session.regenerate(()=>{req.session.isAdmin=true;res.redirect("/admin");});
});

app.post("/upload", requireAdmin, upload.single("videoFile"), (req,res)=>{
  const v=getVideos(); v.unshift({id:Date.now(),title:req.body.title||req.file.originalname,description:req.body.description||"",filename:req.file.filename,date:new Date().toLocaleString()}); saveVideos(v); res.redirect("/admin");
});

app.use("/uploads", (req,res,next)=>{
  if(!hasActiveSub(req)){
    return res.status(403).send("Lipa kwanza kuangalia video. Rudi nyumbani ulipie.");
  }
  next();
}, express.static(uploadDir));

app.post("/logout", requireAdmin, (req,res)=>req.session.destroy(()=>res.redirect("/login")));
app.use(express.static(__dirname,{index:false}));

app.listen(PORT, ()=>console.log("VIDEO-ZONE M-PESA LIVE on http://localhost:"+PORT));