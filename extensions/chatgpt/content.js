console.log("[Chewbacca] content loaded");

const script = document.createElement("script");
script.src = chrome.runtime.getURL("bridge.js");
(document.head || document.documentElement).appendChild(script);

chrome.runtime.sendMessage({type:"content-ready"});

chrome.runtime.onMessage.addListener((msg)=>{
    window.postMessage({
        source:"chewbacca-response",
        payload:msg
    },"*");
});

window.addEventListener("message",(e)=>{
    if(e.source!==window) return;

    if(e.data?.source==="chatgpt"){
        chrome.runtime.sendMessage(e.data.payload);
    }
});

function latestAssistantMessage(){
    const msgs=[
        ...document.querySelectorAll(
            '[data-message-author-role="assistant"]'
        )
    ];

    return msgs.at(-1);
}

function scan(){

    const msg=latestAssistantMessage();

    if(!msg) return;

    const text=msg.innerText;

    const m=text.match(/```chewbacca\s*([\s\S]*?)```/);

    if(!m) return;

    try{

        const payload=JSON.parse(m[1]);

        chrome.runtime.sendMessage(payload);

        msg.dataset.chewbaccaExecuted="true";

    }catch(e){
        console.error(e);
    }

}

new MutationObserver(()=>{
    scan();
}).observe(document.body,{
    subtree:true,
    childList:true,
    characterData:true
});

scan();
