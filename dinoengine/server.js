const http=require("http");const fsp=require("fs/promises");const fs=require("fs");const path=require("path");const{exec}=require("child_process");
const PORT=Number(process.env.DINOENGINE_PORT||4387),ROOT=path.resolve(process.env.DINOENGINE_ROOT||process.cwd()),MAX=10*1024*1024;
const RUNTIMES=[["node","--version"],["npm","--version"],["python","--version"],["py","--version"],["java","--version"],["javac","--version"],["gcc","--version"],["g++","--version"],["clang","--version"],["go","version"],["rustc","--version"],["cargo","--version"],["dotnet","--version"],["php","--version"],["ruby","--version"],["powershell","$PSVersionTable.PSVersion.ToString()"]];
function safe(p=""){const x=path.resolve(ROOT,p);if(x!==ROOT&&!x.startsWith(ROOT+path.sep))throw Error("Path escapes DinoEngine workspace");return x}
function out(r,s,d){const b=JSON.stringify(d,null,2);r.writeHead(s,{"Content-Type":"application/json","Content-Length":Buffer.byteLength(b)});r.end(b)}
function body(q){return new Promise((ok,no)=>{let d="";q.on("data",c=>{d+=c;if(d.length>MAX){q.destroy();no(Error("Request body too large"))}});q.on("end",()=>{try{ok(d?JSON.parse(d):{})}catch{no(Error("Invalid JSON"))}});q.on("error",no)})}
function run(c,cwd=ROOT,t=120000){return new Promise(ok=>exec(c,{cwd:safe(cwd),windowsHide:true,maxBuffer:20*1024*1024,timeout:Number(t)},(e,stdout,stderr)=>ok({ok:!e,code:e?.code??0,stdout,stderr})))}
async function tree(dir=ROOT,rel=""){const es=await fsp.readdir(dir,{withFileTypes:true}),a=[];for(const e of es){if(["node_modules",".git",".dinoengine"].includes(e.name))continue;const p=path.join(rel,e.name);a.push({path:p.replaceAll(path.sep,"/"),type:e.isDirectory()?"folder":"file"});if(e.isDirectory())a.push(...await tree(path.join(dir,e.name),p))}return a}
async function runtimes(){const r={};for(const[x,c]of RUNTIMES)r[x]=await run([c].flat().map(JSON.stringify).join(" "),ROOT,10000);return r}
async function route(q,r){const u=new URL(q.url,"http://localhost"),b=["POST","PUT","PATCH","DELETE"].includes(q.method)?await body(q):{};
if(q.method==="GET"&&u.pathname==="/")return out(r,200,{engine:"DinoEngine",version:"0.2.0",workspace:ROOT,capabilities:["tree","files","read","write","delete","folders","run","runtime-detect","project-inspect","git-status","git-log","git-diff","git-branch"]});
if(q.method==="GET"&&u.pathname==="/api/tree")return out(r,200,{root:ROOT,tree:await tree()});
if(q.method==="GET"&&u.pathname==="/api/files")return out(r,200,{files:(await tree()).filter(x=>x.type==="file").map(x=>x.path)});
if(q.method==="GET"&&u.pathname==="/api/file")return out(r,200,{path:u.searchParams.get("path"),content:await fsp.readFile(safe(u.searchParams.get("path")||""),"utf8")});
if(q.method==="POST"&&u.pathname==="/api/file"){const f=safe(b.path);await fsp.mkdir(path.dirname(f),{recursive:true});await fsp.writeFile(f,String(b.content??""),"utf8");return out(r,200,{ok:true,path:b.path})}
if(q.method==="DELETE"&&u.pathname==="/api/file"){await fsp.rm(safe(b.path),{force:true});return out(r,200,{ok:true,path:b.path})}
if(q.method==="POST"&&u.pathname==="/api/folder"){await fsp.mkdir(safe(b.path),{recursive:true});return out(r,200,{ok:true,path:b.path})}
if(q.method==="POST"&&u.pathname==="/api/run"){if(!b.command)return out(r,400,{error:"command is required"});return out(r,200,await run(String(b.command),b.cwd||ROOT,b.timeout||120000))}
if(q.method==="GET"&&u.pathname==="/api/runtime")return out(r,200,{runtimes:await runtimes()});
if(q.method==="GET"&&u.pathname==="/api/project"){const f=(await tree()).filter(x=>x.type==="file").map(x=>x.path);return out(r,200,{root:ROOT,fileCount:f.length,hasGit:fs.existsSync(path.join(ROOT,".git")),packageFiles:f.filter(x=>/package.json|requirements.txt|pyproject.toml|Cargo.toml|go.mod|pom.xml|build.gradle|csproj$/i.test(path.basename(x)))})}
if(q.method==="GET"&&u.pathname==="/api/git/status")return out(r,200,await run("git status --short --branch"));
if(q.method==="GET"&&u.pathname==="/api/git/log")return out(r,200,await run("git log --oneline -20"));
if(q.method==="GET"&&u.pathname==="/api/git/diff")return out(r,200,await run("git diff"));
if(q.method==="POST"&&u.pathname==="/api/git/branch"){if(!b.name)return out(r,400,{error:"branch name required"});return out(r,200,await run("git branch "+JSON.stringify(String(b.name))))}
if(q.method==="GET"&&u.pathname==="/api/health")return out(r,200,{ok:true,pid:process.pid,node:process.version});
return out(r,404,{error:"Not found"})}
http.createServer((q,r)=>route(q,r).catch(e=>out(r,500,{error:e.message}))).listen(PORT,"127.0.0.1",()=>console.log("DinoEngine v0.2.0 | "+ROOT+" | http://127.0.0.1:"+PORT));