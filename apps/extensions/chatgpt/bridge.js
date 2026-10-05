console.log("[Chewbacca] bridge injected");

window.chewbacca = {
  send(message){
    window.postMessage({
      source:"chatgpt",
      payload:message
    },"*");
  }
};

window.addEventListener("message",(e)=>{
  if(e.source!==window) return;
  if(e.data?.source!=="chewbacca-response") return;
  console.log("[CHEWBACCA RESPONSE]", e.data.payload);
});
