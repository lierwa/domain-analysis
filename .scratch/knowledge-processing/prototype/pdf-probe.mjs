import fs from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const [input,output]=process.argv.slice(2);
const started=performance.now();
const loadingTask=getDocument({data:new Uint8Array(await fs.readFile(input)),isEvalSupported:false,
  useSystemFonts:false,disableFontFace:true,stopAtErrors:true,verbosity:0});
const doc=await loadingTask.promise;
const pages=[];
try {
  for(let number=1;number<=Math.min(5,doc.numPages);number++){
    const page=await doc.getPage(number);
    const content=await page.getTextContent();
    const items=content.items.filter(x=>'str' in x).map(x=>({text:x.str,position:x.transform.slice(4),
      width:x.width,height:x.height,endOfLine:x.hasEOL}));
    // WHY：PDF 的排版坐标不等于业务表格关系；保留原元素顺序供版面审核。
    pages.push({page:number,items,text:items.map(x=>x.text+(x.endOfLine?'\n':' ')).join(''),
      disposition:items.some(x=>x.text.trim())?'pending_layout_review':'no_text_detected'});
    page.cleanup();
  }
  await fs.writeFile(output,JSON.stringify({totalPages:doc.numPages,processedPages:pages.length,pages,
    seconds:(performance.now()-started)/1000,peakRssBytes:process.resourceUsage().maxRSS*1024},null,2));
} finally {await loadingTask.destroy();}
