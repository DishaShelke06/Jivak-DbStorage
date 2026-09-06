(() => {
 const $=s=>document.querySelector(s),keys=['jivak-patients-v1','jivak-visits-v1','jivak-inventory-v1','jivak-followups-v1','jivak-finance-entries-v1'];const read=k=>{try{return JSON.parse(localStorage.getItem(k))||[]}catch{return[]}};const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');const title=k=>({ 'jivak-patients-v1':'Patients','jivak-visits-v1':'Visits','jivak-inventory-v1':'Inventory','jivak-followups-v1':'Follow-ups','jivak-finance-entries-v1':'Finance'}[k]);const keyByTitle=Object.fromEntries(keys.map(k=>[title(k),k]));
 $('#exportExcelBackupBtn').onclick=()=>{const sheets=keys.map(k=>{const rows=read(k),columns=[...new Set(rows.flatMap(x=>Object.keys(x)))];return `<Worksheet ss:Name="${title(k)}"><Table><Row>${columns.map(c=>`<Cell><Data ss:Type="String">${esc(c)}</Data></Cell>`).join('')}</Row>${rows.map(r=>`<Row>${columns.map(c=>`<Cell><Data ss:Type="String">${esc(typeof r[c]==='object'?JSON.stringify(r[c]):r[c])}</Data></Cell>`).join('')}</Row>`).join('')}</Table></Worksheet>`}).join('');const xml=`<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${sheets}</Workbook>`,blob=new Blob([xml],{type:'application/vnd.ms-excel'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`jivak-clinic-export-${new Date().toISOString().slice(0,10)}.xls`;a.click();URL.revokeObjectURL(a.href)};

 // ---- Restore from an Excel (.xls) backup produced by the export above ----
 function parseCellValue(raw){
   const trimmed=(raw??'').trim();
   if((trimmed.startsWith('[')&&trimmed.endsWith(']'))||(trimmed.startsWith('{')&&trimmed.endsWith('}'))){
     try{return JSON.parse(trimmed)}catch{/* fall through, keep as text */}
   }
   if(trimmed!==''&&/^-?\d+(\.\d+)?$/.test(trimmed))return Number(trimmed);
   return raw??'';
 }
 function importExcelBackup(file){
   const reader=new FileReader();
   reader.onload=()=>{
     try{
       const xml=new DOMParser().parseFromString(String(reader.result),'application/xml');
       if(xml.querySelector('parsererror'))throw new Error('invalid xml');
       const worksheets=[...xml.getElementsByTagName('Worksheet')];
       if(!worksheets.length)throw new Error('no sheets found');
       if(!confirm('Restore this Excel backup? Current patient, visit, inventory, follow-up, and finance data will be replaced.'))return;
       const data={};
       worksheets.forEach(ws=>{
         const sheetName=ws.getAttribute('ss:Name');
         const key=keyByTitle[sheetName];
         if(!key)return;
         const rows=[...ws.getElementsByTagName('Row')];
         if(!rows.length){data[key]=[];return}
         const headers=[...rows[0].getElementsByTagName('Cell')].map(c=>c.textContent);
         data[key]=rows.slice(1).map(row=>{
           const cells=[...row.getElementsByTagName('Cell')];
           const record={};
           headers.forEach((h,i)=>{record[h]=parseCellValue(cells[i]?.textContent)});
           return record;
         });
       });
       keys.forEach(k=>localStorage.setItem(k,JSON.stringify(data[k]||[])));
       location.reload();
     }catch(err){
       alert('This is not a valid Jivak Excel backup file.');
     }
   };
   reader.readAsText(file);
 }
 $('#importExcelBackupBtn')?.addEventListener('click',()=>$('#backupExcelFile')?.click());
 $('#backupExcelFile')?.addEventListener('change',e=>{const file=e.target.files[0];if(file)importExcelBackup(file);e.target.value=''});
})();
