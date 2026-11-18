require("dotenv").config();
const express = require("express");
const path = require("path");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const fs = require("fs");
const { createClickPesaOrder } = require("./clickpesa");

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
app.use(session({ secret: process.env.SESSION_SECRET || "videozone", resave:false, saveUninitialized:true, cookie:{maxAge:1000*60*60*24*31}}));

function requireAdmin(req,res,next){ if(req.session.isAdmin) return next(); res.redirect("/login"); }
function hasActiveSub(req){
  if(req.session.isAdmin) return true;
  const subs = getSubs();
  const mySub = subs.find(s => s.sessionId === req.sessionID && new Date(s.expiresAt) > new Date());
  if(mySub) return true;
  if(req.session.customerSub && new Date(req.session.customerSub.expiresAt) > new Date()) return true;
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
  if(activeSub) res.json({ active: true, plan: activeSub.plan, expiresAt: activeSub.expiresAt });
  else res.json({ active: false });
});
app.get("/api/videos", (req,res)=>{
  if(!hasActiveSub(req)) return res.status(403).json({ error: "SUBSCRIPTION_REQUIRED" });
  res.json(getVideos());
});

// STEP 1: TUMA KWA CLICKPESA
app.post("/api/pay", async (req,res)=>{
  const { plan, phone } = req.body;
  let days=1, amount=1500, planName="Siku 1 - 1,500";
  if(plan==="3days"){days=3; amount=1000; planName="Siku 3";}
  if(plan==="monthly"){days=30; amount=5000; planName="Mwezi";}
  try{
    const clickRes = createClickPesaOrder(phone, amount);
    const orderId = clickRes.order_id;
    const gatewayUrl = clickRes.checkout_url;
    const pending = getPending();
    pending.push({ id: orderId, order_id: orderId, sessionId: req.sessionID, plan, planName, amount, days, phone, createdAt: new Date().toISOString(), status:'pending_clickpesa' });
    savePending(pending);
    res.json({ success:true, pendingId: orderId, gateway_url: gatewayUrl, amount, phone });
  }catch(err){
    res.status(500).json({ success:false, message:"ClickPesa error: "+err.message });
  }
});

// STEP 2: CHECK KAMA CLICKPESA IMETHIBITISHA
app.post("/api/confirm-pay", (req,res)=>{
  const { pendingId } = req.body;
  const subs = getSubs();
  const mySub = subs.find(s => s.pendingId === pendingId || s.order_id === pendingId);
  if(mySub && new Date(mySub.expiresAt) > new Date()){
    req.session.customerSub = mySub;
    return res.json({ success:true, verified:true, subscription: mySub });
  }
  return res.status(402).json({ success:false, verified:false, message:"Malipo bado hayajathibitishwa. Umalize kulipa ClickPesa kwanza, au ngoja admin athibitishe." });
});

// STEP 3: CALLBACK YA CLICKPESA
app.post("/api/clickpesa-callback", (req,res)=>{
  console.log("CLICKPESA CALLBACK:", req.body);
  const { order_id, payment_status, transid, reference } = req.body;
  const actualOrderId = order_id || reference;
  if(payment_status === 'COMPLETED' || payment_status === 'SUCCESS' || req.body.result === 'SUCCESS'){
    const pending = getPending();
    const found = pending.find(p => p.id === actualOrderId);
    if(found){
      const expiresAt = new Date(Date.now() + found.days*24*60*60*1000);
      const newSub = { id: Date.now(), order_id: actualOrderId, pendingId: actualOrderId, sessionId: found.sessionId, plan: found.plan, planName: found.planName, amount: found.amount, phone: found.phone, transid, createdAt: new Date().toISOString(), expiresAt: expiresAt.toISOString() };
      const subs = getSubs();
      const filtered = subs.filter(s => s.sessionId !== found.sessionId);
      filtered.push(newSub);
      saveSubs(filtered);
      savePending(pending.filter(p => p.id !== actualOrderId));
      console.log(`✅ CLICKPESA IMETHIBITISHA: ${actualOrderId}`);
    }
  }
  res.status(200).send("OK");
});

app.post("/login", async (req,res)=>{
  const valid = await bcrypt.compare(req.body.password, process.env.ADMIN_PASSWORD_HASH);
  if(req.body.email!==process.env.ADMIN_EMAIL || !valid) return res.status(401).send("Login failed");
  req.session.regenerate(()=>{req.session.isAdmin=true;res.redirect("/admin");});
});
app.post("/upload", requireAdmin, upload.single("videoFile"), (req,res)=>{
  const v=getVideos(); v.unshift({id:Date.now(),title:req.body.title||req.file.originalname,description:req.body.description||"",filename:req.file.filename,date:new Date().toLocaleString()}); saveVideos(v); res.redirect("/admin");
});
app.use("/uploads", (req,res,next)=>{ if(!hasActiveSub(req)) return res.status(403).send("Lipa kwanza"); next(); }, express.static(uploadDir));
app.post("/logout", requireAdmin, (req,res)=>req.session.destroy(()=>res.redirect("/login")));
app.use(express.static(__dirname,{index:false}));
app.listen(PORT, ()=>console.log("LIVE http://localhost:"+PORT));