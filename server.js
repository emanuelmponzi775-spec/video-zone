require("dotenv").config();
const express = require("express");
const path = require("path");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const fs = require("fs");
const app = express();
const PORT = 3000;
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const videosFile = path.join(__dirname, "videos.json");
if (!fs.existsSync(videosFile)) fs.writeFileSync(videosFile, "[]");
function getVideos(){ try{return JSON.parse(fs.readFileSync(videosFile,"utf8"));}catch(e){return [];} }
function saveVideos(v){ fs.writeFileSync(videosFile, JSON.stringify(v,null,2)); }
const storage = multer.diskStorage({destination:(a,b,c)=>c(null,uploadDir),filename:(a,b,c)=>c(null,Date.now()+"-"+b.originalname)});
const upload = multer({storage});
app.use(express.urlencoded({extended:true}));
app.use(express.json());
app.use(session({secret:"secret",resave:false,saveUninitialized:false}));
function requireAdmin(req,res,next){ if(req.session.isAdmin) return next(); res.redirect("/login"); }
app.get("/", (req,res)=>res.sendFile(path.join(__dirname,"index.html")));
app.get("/login", (req,res)=>res.sendFile(path.join(__dirname,"login.html")));
app.get("/admin", requireAdmin, (req,res)=>res.sendFile(path.join(__dirname,"admin.html")));
app.get("/api/videos", (req,res)=>res.json(getVideos()));
app.post("/login", async (req,res)=>{
  const valid = await bcrypt.compare(req.body.password, process.env.ADMIN_PASSWORD_HASH);
  if(req.body.email!==process.env.ADMIN_EMAIL || !valid) return res.status(401).send("Login failed");
  req.session.regenerate(()=>{req.session.isAdmin=true;res.redirect("/admin");});
});
app.post("/upload", requireAdmin, upload.single("videoFile"), (req,res)=>{
  const v=getVideos(); v.unshift({id:Date.now(),title:req.body.title||req.file.originalname,description:req.body.description||"",filename:req.file.filename,date:new Date().toLocaleString()}); saveVideos(v); res.redirect("/admin");
});
app.use("/uploads", express.static(uploadDir));
app.post("/logout", requireAdmin, (req,res)=>req.session.destroy(()=>res.redirect("/login")));
app.use(express.static(__dirname,{index:false}));
app.listen(PORT, ()=>console.log("RUNNING http://localhost:"+PORT));