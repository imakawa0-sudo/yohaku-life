from __future__ import annotations
import argparse, json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

p=argparse.ArgumentParser()
p.add_argument('--export-dir',type=Path,default=Path(__file__).resolve().parent)
p.add_argument('--output',type=Path)
a=p.parse_args()
root=a.export_dir
manifest=json.loads((root/'manifest.json').read_text())
cells=manifest['cells']
assert len(cells)==16
regular='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
bold='/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
font=lambda size,b=False:ImageFont.truetype(bold if b else regular,size)
im=Image.new('RGB',(1100,1562),'#f4f0e7')
d=ImageDraw.Draw(im)
d.text((28,20),'余白の暮らし｜原画レビュー候補',font=font(34,True),fill='#303c37')
d.text((30,70),'初回試作の絵柄を基準に制作  ·  全16パターン  ·  2026.11.23',font=font(18),fill='#59655e')
labels={'clothing-shirt':'衣装｜シャツ','clothing-apron':'衣装｜エプロン','clothing-wrap':'衣装｜合わせの服','clothing-coat':'衣装｜コート','portrait-kaya':'カヤ｜プロフィール','walker-kaya':'カヤ｜全身','walker-sui':'スイ｜全身'}
specific={'portrait-F':'年齢感の修正が残る','walker-kaya':'頭身・顔の目印を再調整','walker-sui':'体格・そばかすを再調整','portrait-H':'丸顔の差を要確認','portrait-I':'角張った輪郭を要確認'}
summary=[]
for i,c in enumerate(cells):
    cid=c.get('case_id') or c.get('id')
    status=c.get('status','review_candidate')
    unfinished=c.get('unfinished',False) or status=='unfinished'
    caveat='caveat' in status
    x=26+(i%4)*266
    y=114+(i//4)*340
    edge='#c48772' if unfinished else ('#c4aa73' if caveat else '#b9c5b8')
    d.rounded_rectangle((x,y,x+250,y+320),radius=9,fill='#fffdf8',outline=edge,width=2)
    label=labels.get(cid,'顔の見本 '+cid.replace('portrait-',''))
    d.text((x+12,y+10),label,font=font(19,True),fill='#34423a')
    f=c['unmodified_crop']['file']
    crop=Image.open(root/f).convert('RGB')
    view=ImageOps.contain(crop,(218,238),Image.Resampling.NEAREST)
    im.paste(view,(x+(250-view.width)//2,y+43+(238-view.height)//2))
    tag='要修正' if unfinished else ('要確認' if caveat else 'レビュー候補')
    reason=specific.get(cid,'同一人物としての差を確認' if cid.startswith('clothing-') else tag)
    d.text((x+12,y+290),reason,font=font(14,unfinished),fill='#a34a37' if unfinished else '#6c634e')
    summary.append({'case_id':cid,'crop':f,'status':status,'unfinished':unfinished})
d.text((28,1490),'赤枠は未完成の3点。全画像はレビュー用で、ゲームにはまだ適用していません。',font=font(17),fill='#6b554a')
d.text((28,1520),'原寸の切り抜きとサイズ別PNGを別途保存。元画像の紙色背景は残っています。',font=font(16),fill='#686c64')
out=a.output or root/'review-sheet.png'
im.save(out,optimize=True)
(root/'review-sheet-manifest.json').write_text(json.dumps({'file':out.name,'size':list(im.size),'purpose':'review-only','cells':summary},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'file':str(out),'size':list(im.size),'cells':len(cells),'unfinished':sum(c['unfinished'] for c in summary)},ensure_ascii=False))
