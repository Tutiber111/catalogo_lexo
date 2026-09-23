"""Save remote browse images locally, verify decoding, and preserve source URLs."""
import concurrent.futures,hashlib,io,json,time,urllib.request
from pathlib import Path
from PIL import Image,ImageOps
ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'web/data/product-browse-data.js'
def main():
 data=json.loads(DATA.read_text(encoding='utf-8').split(' = ',1)[1].rstrip(';\n'))
 urls=sorted({v['image'] for v in data.values() if v.get('image','').startswith('http')})
 def fetch(url):
  target=ROOT/'web/assets/products'/('web-'+hashlib.sha256(url.encode()).hexdigest()[:20]+'.jpg')
  for attempt in range(3):
   try:
    if not target.exists():
     raw=urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=30).read()
     with Image.open(io.BytesIO(raw)) as original:
      im=ImageOps.exif_transpose(original).convert('RGBA');im.thumbnail((800,800),Image.Resampling.LANCZOS)
      bg=Image.new('RGB',im.size,'white');bg.paste(im,mask=im.getchannel('A'));bg.save(target,quality=88,optimize=True)
    with Image.open(target) as im: im.verify()
    return url,'assets/products/'+target.name,None
   except Exception as e:
    if attempt==2:return url,None,str(e)
    time.sleep(attempt+1)
 errors=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
  for n,(url,path,error) in enumerate(pool.map(fetch,urls),1):
   if error:errors.append({'url':url,'error':error})
   else:
    for v in data.values():
     if v.get('image')==url:v.update(image=path,imageSourceUrl=url)
   if n%40==0:print(f'{n}/{len(urls)} images',flush=True)
 DATA.write_text('window.PRODUCT_BROWSE_DATA = '+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
 (ROOT/'tmp/image-download-errors.json').write_text(json.dumps(errors,indent=2),encoding='utf-8')
 print(json.dumps({'downloaded':len(urls)-len(errors),'errors':errors}))
 if errors:raise SystemExit(1)
if __name__=='__main__':main()
