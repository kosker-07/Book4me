// Read-only ledger and balances UI. Financial posting is exclusively server-side.
export async function finance({view,api,session,message,errText}) {
  const root=view();root.replaceChildren();
  const make=(tag,text,parent=root)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);parent.append(e);return e};
  const operator=['system_admin','back_office'].includes(session.user?.role);
  const filters=make('form');filters.className='card';
  const book=make('select',undefined,filters);book.setAttribute('aria-label','Ledger');
  const option=(value,label)=>{const e=make('option',label,book);e.value=value};
  option(operator?'operator':'own',operator?'BED4BOOK operator ledger':'My DMC ledger');
  if(!operator)option('operator','My balance in BED4BOOK operator ledger');
  if(operator){
    try {
      const data=await api('/api/admin/agencies');
      const items=Array.isArray(data)?data:(data.items||data.agencies||[]);
      for(const a of items)if(a.type==='master')option(a.id,a.name);
    }catch(e){message(errText(e))}
  }
  const from=make('input',undefined,filters);from.type='date';from.setAttribute('aria-label','From');
  const to=make('input',undefined,filters);to.type='date';to.setAttribute('aria-label','To');
  const submit=make('button','Filter',filters);submit.type='submit';
  const balanceSection=make('section');balanceSection.className='card';
  const ledgerSection=make('section');ledgerSection.className='card';
  const amount=(value,currency)=>Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' '+currency;
  const cell=(tr,text,tag='td')=>make(tag,text,tr);
  const table=(parent,headings)=>{
    const t=make('table',undefined,parent);const h=make('thead',undefined,t);const row=make('tr',undefined,h);
    for(const name of headings)cell(row,name,'th');
    return make('tbody',undefined,t);
  };
  const financialCell=(row,value,currency)=>{
    const c=cell(row,amount(value,currency));
    if(Number(value)<0)c.className='danger-text';
    return c;
  };
  async function load(){
    balanceSection.replaceChildren();ledgerSection.replaceChildren();
    make('h2','Balances',balanceSection);make('h2','Ledger entries',ledgerSection);
    const q='book='+encodeURIComponent(book.value);
    const range=(from.value?'&from='+encodeURIComponent(from.value):'')+(to.value?'&to='+encodeURIComponent(to.value):'');
    try {
      const [balances,ledger]=await Promise.all([
        api('/api/finance/balances?'+q),api('/api/finance/ledger?'+q+range)
      ]);
      const b=table(balanceSection,['Party','Currency','Debit','Credit','Balance']);
      for(const x of balances.items){
        const tr=make('tr',undefined,b);
        cell(tr,x.party_name||x.party_kind);cell(tr,x.currency);
        financialCell(tr,x.debit,x.currency);financialCell(tr,x.credit,x.currency);
        financialCell(tr,x.balance,x.currency);
      }
      if(!balances.items.length)make('p','No balances',balanceSection);
      const l=table(ledgerSection,['Date','Booking','Description','Party','Debit','Credit']);
      for(const e of ledger.entries)for(const x of e.lines){
        const tr=make('tr',undefined,l);
        cell(tr,new Date(e.postedAt).toLocaleDateString('en-GB'));
        cell(tr,e.bookingNo||'—');cell(tr,e.description||e.kind);
        cell(tr,x.party||x.partyKind);
        financialCell(tr,x.debit,e.currency);financialCell(tr,x.credit,e.currency);
      }
      if(!ledger.entries.length)make('p','No ledger entries',ledgerSection);
    }catch(e){message(errText(e));make('p','Unable to load finance data',ledgerSection)}
  }
  filters.addEventListener('submit',e=>{e.preventDefault();void load()});
  book.addEventListener('change',()=>void load());
  await load();
}
