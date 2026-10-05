let port = null;

function connect() {
    if (port) return;

    console.log("[Chewbacca] connecting...");

    port = chrome.runtime.connectNative("com.chewbacca.bridge");

    port.onMessage.addListener(msg => {
        chrome.tabs.query({}, tabs => {
            for (const tab of tabs) {
                chrome.tabs.sendMessage(tab.id, {
                    type: "__CHEWBACCA_RESULT__",
                    payload: msg
                }).catch?.(()=>{});
            }
        });
    });

    port.onDisconnect.addListener(() => {
        console.warn("[Chewbacca] native disconnected");

        port = null;

        setTimeout(connect,250);
    });
}

connect();

chrome.runtime.onMessage.addListener((msg,sender,reply)=>{

    connect();

    if(!port){
        reply({
            ok:false,
            error:"bridge unavailable"
        });
        return true;
    }

    try{
        port.postMessage(msg);
        reply({ok:true});
    }catch(e){
        port=null;
        connect();

        reply({
            ok:false,
            error:String(e)
        });
    }

    return true;
});
