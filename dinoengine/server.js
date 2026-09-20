const http=require("http");
const fsp=require("fs/promises");
const fs=require("fs");
const path=require("path");
const {exec}=require("child_process");

const VERSION="0.5.0";
const PORT=Number(process.env.DINOENGINE_PORT||4387);
const ROOT=path.resolve(process.env.DINOENGINE_ROOT||process.cwd());
const MAX=10*1024*1024;
const DEFAULT_TIMEOUT=120000;

const RUNTIMES=[
 ["node","--version"],["npm","--version"],["python","--version"],["py","--version"],
 ["java","--version"],["javac","--version"],["gcc","--version"],["g++","--version"],
 ["clang","--version"],["go","version"],["rustc","--version"],["cargo","--version"],
 ["dotnet","--version"],["php","--version"],["ruby","--version"],["git","--version"],
 ["vercel","--version"],["netlify","--version"]
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
async function git(args,cwd=ROOT){ return run("git "+args,cwd); }

async function writeFiles(files){
 if(!Array.isArray(files)||!files.length) throw Error("files must be a non-empty array");
 const written=[];
 for(const item of files){
  if(!item||typeof item.path!=="string") throw Error("Each file needs a path");
  const f=safe(item.path);
  await fsp.mkdir(path.dirname(f),{recursive:true});
  await fsp.writeFile(f,String(item.content??""),"utf8");
  written.push(item.path);
 }
 return {ok:true,written};
}

async function createWebsite(args){
 const name=String(args.name||"website").trim().replace(/[^a-zA-Z0-9_-]/g,"-").toLowerCase();
 const dir=String(args.directory||name);
 const root=safe(dir);
 await fsp.mkdir(root,{recursive:true});
 const files=Array.isArray(args.files)&&args.files.length?args.files:[
  {path:path.posix.join(dir,"index.html"),content:"<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>"+name+"</title></head><body><main><h1>"+name+"</h1><p>Built with DinoEngine.</p></main></body></html>"}
 ];
 return await writeFiles(files);
}

async function publishWebsite(args){
 const provider=String(args.provider||"github-pages").toLowerCase();
 const message=String(args.message||"Publish website with DinoEngine");
 if(provider==="github-pages"||provider==="github"){
  const branch=String(args.branch||"gh-pages");
  const checkout=await git("checkout "+JSON.stringify(branch));
  let result=checkout;
  if(!checkout.ok) result=await git("checkout -B "+JSON.stringify(branch));
  if(!result.ok) return result;
  const commit=await git("add -A && git commit -m "+JSON.stringify(message));
  const push=await git("push -u origin "+JSON.stringify(branch));
  return {provider:"github-pages",branch,commit,push,note:"Enable GitHub Pages for this branch/repository if it is not already enabled."};
 }
 if(provider==="vercel"){
  return await run("vercel --prod --yes",ROOT,300000);
 }
 if(provider==="netlify"){
  return await run("netlify deploy --prod",ROOT,300000);
 }
 throw Error("Unsupported provider. Use github-pages, vercel, or netlify.");
}

async function tool(name,args={}){
 switch(name){
  case "workspace_tree": return {root:ROOT,tree:await tree()};
  case "read_file": return {path:args.path,content:await fsp.readFile(safe(args.path),"utf8")};
  case "write_file": return await writeFiles([{path:args.path,content:args.content}]);
  case "write_files": return await writeFiles(args.files);
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
  case "website_create": return await createWebsite(args);
  case "website_publish": return await publishWebsite(args);
  case "deploy_command": return await run(args.command,ROOT,args.timeout||300000);
  case "engine_info": return {engine:"DinoEngine",version:VERSION,workspace:ROOT,protocol:"DinoMCP/1.0",capabilities:TOOL_DEFS.map(x=>x.name),gptIntegration:"MCP connector"};
  default: throw Error("Unknown tool: "+name);
 }
}

const S=type=>({type});
const TOOL_DEFS=[
 {name:"workspace_tree",description:"List the workspace tree",inputSchema:{type:"object",properties:{},additionalProperties:false}},
 {name:"read_file",description:"Read a UTF-8 file",inputSchema:{type:"object",properties:{path:S("string")},required:["path"]}},
 {name:"write_file",description:"Create or replace one UTF-8 file",inputSchema:{type:"object",properties:{path:S("string"),content:S("string")},required:["path","content"]}},
 {name:"write_files",description:"Create or replace multiple website/project files in one call",inputSchema:{type:"object",properties:{files:{type:"array",items:{type:"object",properties:{path:S("string"),content:S("string")},required:["path","content"]}}},required:["files"]}},
 {name:"delete_file",description:"Delete a file or folder",inputSchema:{type:"object",properties:{path:S("string"),recursive:S("boolean")},required:["path"]}},
 {name:"make_folder",description:"Create a folder",inputSchema:{type:"object",properties:{path:S("string")},required:["path"]}},
 {name:"run",description:"Run a command inside the workspace",inputSchema:{type:"object",properties:{command:S("string"),cwd:S("string"),timeout:S("number")},required:["command"]}},
 {name:"runtimes",description:"Detect installed development and website deployment runtimes",inputSchema:{type:"object",properties:{},additionalProperties:false}},
 {name:"project_inspect",description:"Inspect project files and Git state",inputSchema:{type:"object",properties:{},additionalProperties:false}},
 {name:"git_status",description:"Get Git status",inputSchema:{type:"object",properties:{},additionalProperties:false}},
 {name:"git_log",description:"Get recent Git commits",inputSchema:{type:"object",properties:{},additionalProperties:false}},
 {name:"git_diff",description:"Get current Git diff",inputSchema:{type:"object",properties:{},additionalProperties:false}},
 {name:"git_branch",description:"List Git branches",inputSchema:{type:"object",properties:{},additionalProperties:false}},
 {name:"git_create_branch",description:"Create a Git branch",inputSchema:{type:"object",properties:{name:S("string")},required:["name"]}},
 {name:"git_checkout",description:"Switch Git branch",inputSchema:{type:"object",properties:{name:S("string")},required:["name"]}},
 {name:"git_commit",description:"Stage all changes and create a commit",inputSchema:{type:"object",properties:{message:S("string")}}},
 {name:"git_push",description:"Push Git changes",inputSchema:{type:"object",properties:{remote:S("string"),branch:S("string")}}},
 {name:"git_pull",description:"Pull Git changes",inputSchema:{type:"object",properties:{remote:S("string"),branch:S("string")}}},
 {name:"website_create",description:"Create a website project and its files from GPT-generated content",inputSchema:{type:"object",properties:{name:S("string"),directory:S("string"),files:{type:"array",items:{type:"object",properties:{path:S("string"),content:S("string")},required:["path","content"]}}},required:["name","files"]}},
 {name:"website_publish",description:"Publish the current website using GitHub Pages, Vercel, or Netlify",inputSchema:{type:"object",properties:{provider:{type:"string",enum:["github-pages","vercel","netlify"]},branch:S("string"),message:S("string")},required:["provider"]}},
 {name:"deploy_command",description:"Run a deployment command in the workspace",inputSchema:{type:"object",properties:{command:S("string"),timeout:S("number")},required:["command"]}},
 {name:"engine_info",description:"Get DinoEngine version, protocol, and capabilities",inputSchema:{type:"object",properties:{},additionalProperties:false}}
];

async function mcp(req,res,b){
 const id=b.id??null;
 try{
  if(b.method==="initialize") return out(res,200,{jsonrpc:"2.0",id,result:{protocolVersion:"2025-06-18",serverInfo:{name:"DinoEngine",version:VERSION},capabilities:{tools:{}}}});
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
 if(q.method==="GET"&&u.pathname==="/") return out(r,200,{engine:"DinoEngine",version:VERSION,workspace:ROOT,protocol:"DinoMCP/1.0",mcp:"/mcp",capabilities:TOOL_DEFS.map(x=>x.name),websitePublishing:["github-pages","vercel","netlify"]});
 if(q.method==="GET"&&u.pathname==="/api/tree") return out(r,200,await tool("workspace_tree"));
 if(q.method==="GET"&&u.pathname==="/api/files") return out(r,200,{files:(await tree()).filter(x=>x.type==="file").map(x=>x.path)});
 if(q.method==="GET"&&u.pathname==="/api/file") return out(r,200,await tool("read_file",{path:u.searchParams.get("path")||""}));
 if(q.method==="POST"&&u.pathname==="/api/file") return out(r,200,await tool("write_file",b));
 if(q.method==="DELETE"&&u.pathname==="/api/file") return out(r,200,await tool("delete_file",b));
 if(q.method==="POST"&&u.pathname==="/api/folder") return out(r,200,await tool("make_folder",b));
 if(q.method==="POST"&&u.pathname==="/api/run") return out(r,200,await tool("run",b));
 if(q.method==="GET"&&u.pathname==="/api/runtime") return out(r,200,{runtimes:await runtimes()});
 if(q.method==="GET"&&u.pathname==="/api/project") return out(r,200,await tool("project_inspect"));
 if(q.method==="GET"&&u.pathname==="/api/health") return out(r,200,{ok:true,pid:process.pid,node:process.version,version:VERSION});
 return out(r,404,{error:"Not found"});
}
http.createServer((q,r)=>route(q,r).catch(e=>out(r,500,{error:e.message}))).listen(PORT,"127.0.0.1",()=>console.log("DinoEngine v"+VERSION+" | "+ROOT+" | http://127.0.0.1:"+PORT));
