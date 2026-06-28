const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "AIzaSyDDsXFshpdrhwcH6Uui2nDkgRTAc0zyoRE");

async function listModels() {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?key=" + "AIzaSyDDsXFshpdrhwcH6Uui2nDkgRTAc0zyoRE");
  const data = await response.json();
  console.log(data.models.map(m => m.name));
}

listModels();
