const http=require("http");
const fsp=require("fs/promises");
const fs=require("fs");
const path=require("path");
const {exec}=require("child_process");

const VERSION="0.4.0";
const PORT=Number(process.env.DINOENGINE_PORT||4387);
const ROOT=path.resolve(process.env.DINOENGINE_ROOT||process.cwd());
const MAX=10*1024*1024;
const DEFAULT_TIMEOUT=120000;

const RUNTIMES=[
 ["node","--version"],["npm","--version"],["python","--version"],["py","--version"],
 ["java","--version"],["javac","--version"],["gcc","--version"],["g++","--version"],
 ["clang","--version"],["go","version"],["rustc","--version"],["cargo","--version"],
 ["dotnet","--version"],["php","--version"],["ruby","--version"],
 ["powershell","$PSVersionTable.PSVersion.ToString()"]
];

function safe(p=""){
 const x=path.resolve(ROOT,p);
 if(x!==ROOT&&!x.startsWith(ROOT+path.sep)) throw Error("Path escapes DinoEngine workspace");
 return x;
}
function out(r,status,data){
 const b=JSON.stringify(data,null,2);
 r.writeHead(status,{"Content-Type":"application/json","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type","Content-Length":Buffer.byteLength(b)});
 r.end(b);
}
function body(q){
 return new Promise((ok,no)=>{
  let d="";
  q.on("data",c=>{d+=c;if(d.length>MAX){q.destroy();no(Error("Request body too large"))}});
  q.on("end",()=>{try{ok(d?JSON.parse(d):{})}catch{no(Error("Invalid JSON"))}});
  q.on("error",no);
 });
}
function run(command,cwd=ROOT,timeout=DEFAULT_TIMEOUT){
 return new Promise(resolve=>{
  exec(String(command),{cwd:safe(cwd),windowsHide:true,maxBuffer:20*1024*1024,timeout:Number(timeout)||DEFAULT_TIMEOUT},
   (e,stdout,stderr)=>resolve({ok:!e,code:e?.code??0,stdout,stderr}));
 });
}
async function tree(dir=ROOT,rel=""){
 const es=await fsp.readdir(dir,{withFileTypes:true}),a=[];
 for(const e of es){
  if(["node_modules",".git",".dinoengine","release"].includes(e.name)) continue;
  const p=path.join(rel,e.name);
  a.push({path:p.replaceAll(path.sep,"/"),type:e.isDirectory()?"folder":"file"});
  if(e.isDirectory()) a.push(...await tree(path.join(dir,e.name),p));
 }
 return a;
}
async function runtimes(){
 const r={};
 for(const [name,cmd] of RUNTIMES) r[name]=await run(cmd,ROOT,10000);
 return r;
}
async function git(args,cwd=ROOT){
 return run("git "+args,cwd);
}
async function tool(name,args={}){
 switch(name){
  case "workspace_tree": return {root:ROOT,tree:await tree()};
  case "read_file": return {path:args.path,content:await fsp.readFile(safe(args.path),"utf8")};
  case "write_file":{
   const f=safe(args.path); await fsp.mkdir(path.dirname(f),{recursive:true});
   await fsp.writeFile(f,String(args.content??""),"utf8"); return {ok:true,path:args.path};
  }
  case "delete_file": await fsp.rm(safe(args.path),{recursive:!!args.recursive,force:true}); return {ok:true,path:args.path};
  case "make_folder": await fsp.mkdir(safe(args.path),{recursive:true}); return {ok:true,path:args.path};
  case "run": return await run(args.command,args.cwd||ROOT,args.timeout||DEFAULT_TIMEOUT);
  case "runtimes": return await runtimes();
  case "project_inspect":{
   const files=(await tree()).filter(x=>x.type==="file").map(x=>x.path);
   return {root:ROOT,fileCount:files.length,hasGit:fs.existsSync(path.join(ROOT,".git")),packageFiles:files.filter(x=>/package.json|requirements.txt|pyproject.toml|Cargo.toml|go.mod|pom.xml|build.gradle|csproj$/i.test(path.basename(x)))};
  }
  case "git_status": return await git("status --short --branch");
  case "git_log": return await git("log --oneline -20");
  case "git_diff": return await git("diff");
  case "git_branch": return await git("branch");
  case "git_create_branch": return await git("branch "+JSON.stringify(String(args.name)));
  case "git_checkout": return await git("checkout "+JSON.stringify(String(args.name)));
  case "git_commit": return await git("add -A && git commit -m "+JSON.stringify(String(args.message||"DinoEngine commit")));
  case "git_push": return await git("push "+(args.remote?JSON.stringify(args.remote):"origin")+" "+(args.branch?JSON.stringify(args.branch):"HEAD"));
  case "git_pull": return await git("pull "+(args.remote?JSON.stringify(args.remote):"origin")+" "+(args.branch?JSON.stringify(args.branch):""));
  case "engine_info": return {engine:"DinoEngine",version:VERSION,workspace:ROOT,protocol:"DinoMCP/1.0",capabilities:TOOL_DEFS.map(x=>x.name)};
  default: throw Error("Unknown tool: "+name);
 }
}

const TOOL_DEFS=[
 {name:"workspace_tree",description:"List the workspace tree"},
 {name:"read_file",description:"Read a UTF-8 file"},
 {name:"write_file",description:"Create or replace a UTF-8 file"},
 {name:"delete_file",description:"Delete a file or folder"},
 {name:"make_folder",description:"Create a folder"},
 {name:"run",description:"Run a command inside the workspace"},
 {name:"runtimes",description:"Detect installed development runtimes"},
 {name:"project_inspect",description:"Inspect project files and Git state"},
 {name:"git_status",description:"Get Git status"},
 {name:"git_log",description:"Get recent Git commits"},
 {name:"git_diff",description:"Get current Git diff"},
 {name:"git_branch",description:"List Git branches"},
 {name:"git_create_branch",description:"Create a Git branch"},
 {name:"git_checkout",description:"Switch Git branch"},
 {name:"git_commit",description:"Stage all changes and create a commit"},
 {name:"git_push",description:"Push Git changes"},
 {name:"git_pull",description:"Pull Git changes"},
 {name:"engine_info",description:"Get DinoEngine version and capabilities"}
];

async function mcp(req,res,b){
 const id=b.id??null;
 try{
  if(b.method==="initialize") return out(res,200,{jsonrpc:"2.0",id,result:{protocolVersion:"DinoMCP/1.0",serverInfo:{name:"DinoEngine",version:VERSION},capabilities:{tools:{}}}});
  if(b.method==="tools/list") return out(res,200,{jsonrpc:"2.0",id,result:{tools:TOOL_DEFS}});
  if(b.method==="tools/call"){
   const result=await tool(b.params?.name,b.params?.arguments||{});
   return out(res,200,{jsonrpc:"2.0",id,result:{content:[{type:"text",text:JSON.stringify(result,null,2)}],structuredContent:result}});
  }
  if(b.method==="ping") return out(res,200,{jsonrpc:"2.0",id,result:{}});
  return out(res,200,{jsonrpc:"2.0",id,error:{code:-32601,message:"Method not found"}});
 }catch(e){return out(res,200,{jsonrpc:"2.0",id,error:{code:-32000,message:e.message}})}
}

async function route(q,r){
 const u=new URL(q.url,"http://localhost");
 if(q.method==="OPTIONS"){r.writeHead(204,{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type"});return r.end();}
 const b=["POST","PUT","PATCH","DELETE"].includes(q.method)?await body(q):{};
 if(q.method==="POST"&&u.pathname==="/mcp") return mcp(q,r,b);
 if(q.method==="GET"&&u.pathname==="/") return out(r,200,{engine:"DinoEngine",version:VERSION,workspace:ROOT,protocol:"DinoMCP/1.0",mcp:"/mcp",capabilities:TOOL_DEFS.map(x=>x.name)});
 if(q.method==="GET"&&u.pathname==="/api/tree") return out(r,200,await tool("workspace_tree"));
 if(q.method==="GET"&&u.pathname==="/api/files") return out(r,200,{files:(await tree()).filter(x=>x.type==="file").map(x=>x.path)});
 if(q.method==="GET"&&u.pathname==="/api/file") return out(r,200,await tool("read_file",{path:u.searchParams.get("path")||""}));
 if(q.method==="POST"&&u.pathname==="/api/file") return out(r,200,await tool("write_file",b));
 if(q.method==="DELETE"&&u.pathname==="/api/file") return out(r,200,await tool("delete_file",b));
 if(q.method==="POST"&&u.pathname==="/api/folder") return out(r,200,await tool("make_folder",b));
 if(q.method==="POST"&&u.pathname==="/api/run") return out(r,200,await tool("run",b));
 if(q.method==="GET"&&u.pathname==="/api/runtime") return out(r,200,{runtimes:await runtimes()});
 if(q.method==="GET"&&u.pathname==="/api/project") return out(r,200,await tool("project_inspect"));
 if(q.method==="GET"&&u.pathname==="/api/git/status") return out(r,200,await git("status --short --branch"));
 if(q.method==="GET"&&u.pathname==="/api/git/log") return out(r,200,await git("log --oneline -20"));
 if(q.method==="GET"&&u.pathname==="/api/git/diff") return out(r,200,await git("diff"));
 if(q.method==="POST"&&u.pathname==="/api/git/branch") return out(r,200,await tool("git_create_branch",b));
 if(q.method==="GET"&&u.pathname==="/api/health") return out(r,200,{ok:true,pid:process.pid,node:process.version,version:VERSION});
 return out(r,404,{error:"Not found"});
}
http.createServer((q,r)=>route(q,r).catch(e=>out(r,500,{error:e.message}))).listen(PORT,"127.0.0.1",()=>console.log("DinoEngine v"+VERSION+" | "+ROOT+" | http://127.0.0.1:"+PORT));
