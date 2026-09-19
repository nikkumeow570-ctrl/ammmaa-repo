async function playAmmaVoice(text){
  text = text || "Kutty, thanni kudichiya da?";
  console.log("Playing:", text);
  try{
    const res = await fetch('/api/voice',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ text })
    });
    if(!res.ok){
      const err = await res.text();
      alert("Voice error: "+err);
      return;
    }
    const blob = await res.blob();
    console.log("Audio blob size:", blob.size);
    const url = URL.createObjectURL(blob);
    const a = new Audio(url);
    a.play().then(()=>console.log("Playing...")).catch(e=>alert(e));
  }catch(e){
    alert("Failed: "+e.message);
  }
}
