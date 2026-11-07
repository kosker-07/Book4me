import {test,expect} from '@playwright/test';
const profile=(role)=>({id:'u1',email:'test@example.com',role,agencyId:'a1'});
async function mock(page,role='sub_agency'){
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const method=route.request().method();
  const respond=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  if(path==='/api/auth/login')return respond({token:'test-session',tokenType:'Bearer',expiresIn:28800,user:profile(role)});
  if(path==='/api/me')return respond({userId:'u1',role,agencyId:'a1'});
  if(path==='/api/agency/searches')return respond({results:[{quoteId:'quote-1',hotel:{id:'h1',name:'Test Otel',location:'Antalya'},room:{name:'Deluxe'},board:'BB',total:'220.00',currency:'EUR',nights:[{date:'2026-12-01',price:'110.00'}]}]});
  if(path==='/api/agency/bookings'&&method==='POST')return respond({id:'b1',bookingNo:'B4B-00000001',status:'pending',total:'220.00',currency:'EUR'},201);
  if(path==='/api/agency/bookings')return respond({items:[{id:'b1',booking_no:'B4B-00000001',status:'pending',hotel_name:'Test Otel',total:'220.00',currency:'EUR'}]});
  if(path==='/api/backoffice/bookings')return respond({items:[{id:'b1',booking_no:'B4B-00000001',status:'pending',hotel_name:'Test Otel',total:'220.00',currency:'EUR'}]});
  if(path.endsWith('/status'))return respond({id:'b1',status:'approved'});
  if(path==='/api/auth/logout')return respond({ok:true});
  return respond({items:[]});
 });
}
test('agency login, search, quote and booking',async({page})=>{
 await mock(page);await page.goto('/');await page.getByTestId('email').fill('test@example.com');await page.getByTestId('password').fill('strongpassword');await page.getByTestId('login').click();
 await expect(page.getByTestId('search-form')).toBeVisible();await page.getByTestId('search').click();await expect(page.getByText('Test Otel').first()).toBeVisible();
 await page.getByTestId('select-quote').click();for(const [name,value] of Object.entries({firstName:'Ayşe',lastName:'Yılmaz',email:'ayse@example.com',phone:'+905551112233',nationality:'TR',operationNote:'Test'}))await page.getByTestId(name).last().fill(value);
 await page.getByTestId('booking').click();await expect(page.getByText(/Rezervasyon oluşturuldu/)).toBeVisible();
});
test('master agency never sees cancel action',async({page})=>{
 await mock(page,'master_agency');await page.goto('/');await page.getByTestId('email').fill('test@example.com');await page.getByTestId('password').fill('strongpassword');await page.getByTestId('login').click();
 await expect(page.getByTestId('approve')).toBeVisible();await expect(page.getByTestId('cancel')).toHaveCount(0);
});
