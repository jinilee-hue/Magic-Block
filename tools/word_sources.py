"""The source list of the 46 block words → docs/word_sources.xlsx (user: "단어들에 대한 교재 출처 리스트 뽑아줘").

Per word: m-word or not, Korean gloss, part of speech, the FPR K Unit 1 lessons and pages it is on (printed text or
picture), whether it is on the Unit 1 picture cards (p387), and whether the game has a picture card for it. The table
itself carries only words, glosses, lessons and page numbers — never the textbook's sentences.
Source ledger: ~/dev/sadfpr-studio/data/b2_book_FPRK.json (SAD·FPR 단어 연구 자료집).

With --pdf (the FPR K student book PDF) a second sheet '증빙 화면' shows each page a word is on (user: "교재 출처
엑셀파일에 교재 화면 이미지도 붙여줄수 있어? 증빙을 해야해서"): the page with the word boxed in red where it is printed
(found by local OCR — macOS Vision, on this Mac only) plus a close-up, or the whole page where the word is a picture.
The textbook is internal material: that file is for internal evidence only (docs/word_sources.xlsx is gitignored).
The PDF the sadfpr-studio app keeps (its IndexedDB, blob 9 = FPR K, 400 pages; ledger page p = PDF page p) works.

Run: uv run --with openpyxl python tools/word_sources.py
     uv run --with openpyxl --with pillow --with pymupdf --with pyobjc-framework-Vision python tools/word_sources.py --pdf <FPR K.pdf>
"""
import argparse
import json
import os
import pathlib
import re
import shutil
import tempfile
from collections import defaultdict

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.hyperlink import Hyperlink

ap = argparse.ArgumentParser()
ap.add_argument('--pdf', help='FPR K student book PDF: adds the evidence sheet with the textbook pages')
args = ap.parse_args()

ROOT = pathlib.Path(__file__).resolve().parent.parent
W = json.loads((ROOT / 'src/data/words.json').read_text(encoding='utf-8'))
CARDS = set(json.loads((ROOT / 'src/data/cards.json').read_text(encoding='utf-8')))
B = json.loads(pathlib.Path(os.path.expanduser('~/dev/sadfpr-studio/data/b2_book_FPRK.json')).read_text(encoding='utf-8'))
LU = {int(k): v for k, v in B['lu'].items()}
P387 = set(B['cards']['387']['cards'])
KIND = {'printed': '글', 'picture': '그림', 'printed+picture': '글+그림'}

# Unit 1 rows per lemma: page → lessons, kinds, printed forms (no snippets)
unit1 = defaultdict(lambda: defaultdict(lambda: {'lessons': set(), 'kinds': set(), 'forms': set()}))
for r in B['rows']:
    les = r.get('lesson')
    if not les or LU.get(les) != 1:
        continue
    e = unit1[r['lemma']][r['page']]
    e['lessons'].add(les)
    e['kinds'].add(KIND.get(str(r.get('kind', '')).lower(), str(r.get('kind', ''))))
    e['forms'].update(f.lower() for f in {r['lemma'], *(r.get('surfaces') or [])})

TRAPS = {w['w'] for w in W['words'] if not w['m'] and 'm' in w['w']}
POS = {'noun': '명사', 'verb': '동사', 'adjective': '형용사', 'pronoun': '대명사', 'determiner': '한정사', 'adverb': '부사'}
rows, words = [], []
for w in sorted(W['words'], key=lambda x: (not x['m'], x['w'])):
    lemma = w.get('lemma', w['w'])
    pages = unit1.get(lemma, {})
    lessons = sorted({l for e in pages.values() for l in e['lessons']})
    page_s = ', '.join(f"p.{p} ({'/'.join(sorted(e['kinds']))})" if e['kinds'] - {''} else f'p.{p}' for p, e in sorted(pages.items()))
    on_card = lemma in P387
    note = []
    if not pages and on_card:
        note.append('본문에는 없고 Unit 1 그림카드(p387)에만 나옴')
    if w['w'] in TRAPS:
        note.append('함정 단어: m이 단어 안에 있음(첫소리 아님)')
    if w['m'] and w['w'] not in CARDS:
        note.append('게임 그림카드 없음(블럭만 나옴)')
    rows.append([
        'm단어' if w['m'] else '다른 단어', w['w'], w.get('ko', ''), POS.get(w.get('pos', ''), w.get('pos', '')),
        ', '.join(f'L{l}' for l in lessons) or '—', page_s or '—', 'O' if on_card else '—',
        ('O' if w['w'] in CARDS else '—') if w['m'] else '해당 없음', ' · '.join(note),
    ])
    words.append((w, lemma, pages, on_card))

wb = Workbook()
ws = wb.active
assert ws is not None
ws.title = '단어 출처'
title = f"Magic Jenga 블럭 단어 {len(rows)}개 — 교재 출처"
info = (f"교재: {W['book']} · 본문 p.9–76 + 그림카드 p387  |  원자료: {W['source']}  |  표에는 교재 문장을 싣지 않음(단어·뜻·쪽만)"
        + ("  |  '증빙 화면' 시트: 교재 쪽 화면 — 내부 증빙용, 외부 공유 금지" if args.pdf else ''))
ws.append([title]); ws.append([info]); ws.append([])
head = ['구분', '단어', '뜻', '품사', 'Unit 1 레슨', 'Unit 1 쪽 (글/그림)', '그림카드 p387', '게임 그림카드', '비고'] + (['증빙 화면'] if args.pdf else [])
ws.append(head)
for r in rows:
    ws.append(r)
ws['A1'].font = Font(bold=True, size=14)
ws['A2'].font = Font(size=9, color='666666')
ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(head))
ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=len(head))
thin = Side(style='thin', color='D9D2EE')
HEAD_FILL, M_FILL = PatternFill('solid', fgColor='7553B8'), PatternFill('solid', fgColor='F4EFFC')
for c in range(1, len(head) + 1):
    cell = ws.cell(row=4, column=c)
    cell.font = Font(bold=True, color='FFFFFF'); cell.fill = HEAD_FILL
    cell.alignment = Alignment(horizontal='center', vertical='center')
for i, r in enumerate(rows, start=5):
    for c in range(1, len(head) + 1):
        cell = ws.cell(row=i, column=c)
        cell.border = Border(top=thin, bottom=thin, left=thin, right=thin)
        cell.alignment = Alignment(vertical='center', wrap_text=c in (6, 9), horizontal='center' if c in (1, 4, 5, 7, 8, 10) else 'left')
        if r[0] == 'm단어':
            cell.fill = M_FILL
    ws.cell(row=i, column=2).font = Font(bold=True)
for c, wdt in enumerate([10, 12, 12, 8, 22, 44, 13, 13, 40, 16][:len(head)], start=1):
    ws.column_dimensions[get_column_letter(c)].width = wdt
ws.freeze_panes = 'C5'
ws.auto_filter.ref = f'A4:{get_column_letter(len(head))}{4 + len(rows)}'

stats = None
if args.pdf:
    import fitz
    import Vision
    from Foundation import NSURL
    from openpyxl.drawing.image import Image as XLImage
    from PIL import Image, ImageDraw

    DPI, ZOOM_DPI, THUMB_H = 150, 220, 520          # OCR / close-up resolution; page picture height in the sheet (px)
    doc = fitz.open(args.pdf)
    tmp = pathlib.Path(tempfile.mkdtemp(dir=os.environ.get('TMPDIR')))
    page_img, page_ocr = {}, {}

    def render(p):
        if p not in page_img:
            pth = tmp / f'p{p}.png'
            doc[p - 1].get_pixmap(dpi=DPI).save(str(pth))
            page_img[p] = pth
        return page_img[p]

    def ocr_lines(p, dpi):
        """Vision's text lines of a page: [(text, candidate, width, height)] at this dpi"""
        if (p, dpi) in page_ocr:
            return page_ocr[(p, dpi)]
        pth = render(p) if dpi == DPI else tmp / f'p{p}_{dpi}.png'
        if dpi != DPI:
            doc[p - 1].get_pixmap(dpi=dpi).save(str(pth))
        im = Image.open(pth)
        req = Vision.VNRecognizeTextRequest.alloc().init()
        req.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
        req.setUsesLanguageCorrection_(False)
        Vision.VNImageRequestHandler.alloc().initWithURL_options_(NSURL.fileURLWithPath_(str(pth)), None).performRequests_error_([req], None)
        out = [(str(o.topCandidates_(1)[0].string()), o.topCandidates_(1)[0], im.width, im.height) for o in req.results() or []]
        page_ocr[(p, dpi)] = out
        return out

    def find(p, forms):
        """the word's boxes on the page (px at DPI): the forms as words, letters also set apart ("s i t", "m-a-p");
        a 300 dpi re-read when the first one finds nothing"""
        for dpi in (DPI, 300):
            boxes = []
            for text, cand, Wd, Ht in ocr_lines(p, dpi):
                low = text.lower()
                for f in forms:
                    pat = r'(?<![a-z])' + r'[\s\-]?'.join(map(re.escape, f)) + r'(?![a-z])'
                    for m in re.finditer(pat, low):
                        box, _ = cand.boundingBoxForRange_error_((m.start(), m.end() - m.start()), None)
                        if box is None:
                            continue
                        bb, k = box.boundingBox(), DPI / dpi
                        x0, y1 = bb.origin.x * Wd * k, (1 - bb.origin.y) * Ht * k
                        boxes.append((x0, y1 - bb.size.height * Ht * k, x0 + bb.size.width * Wd * k, y1))
            if boxes:
                return boxes
        return []

    def boxed(src, boxes, scale, width=4):
        im = src.convert('RGB')
        d = ImageDraw.Draw(im)
        for x0, y0, x1, y1 in boxes:
            pad = 0.25 * (y1 - y0)
            d.rounded_rectangle([(x0 - pad) * scale, (y0 - pad) * scale, (x1 + pad) * scale, (y1 + pad) * scale], radius=6, outline=(230, 30, 60), width=width)
        return im

    ev = wb.create_sheet('증빙 화면')
    ev.append([f'교재 화면 증빙 — {W["book"]} (내부 증빙용, 외부 공유 금지)'])
    ev.append(['글로 나온 쪽: 화면 속 단어를 빨간 상자로 표시(이 Mac에서 OCR로 찾음) + 확대 · 그림으로 나온 쪽: 그 쪽 전체 화면'])
    ev.append([])
    ev_head = ['단어', '쪽', '레슨', '나온 형태', '화면 표시', '교재 쪽 화면', '확대']
    ev.append(ev_head)
    for c in range(1, len(ev_head) + 1):
        cell = ev.cell(row=4, column=c)
        cell.font = Font(bold=True, color='FFFFFF'); cell.fill = HEAD_FILL
        cell.alignment = Alignment(horizontal='center', vertical='center')
    ev['A1'].font = Font(bold=True, size=14)
    ev['A2'].font = Font(size=9, color='666666')
    keep = []                                   # the XLImages' files must live until the save
    first_row = {}
    r_i, n_imgs, printed, found = 5, 0, 0, 0
    thumb_w_max, zoom_w_max = 0, 0
    for w, lemma, pages, on_card in words:
        entries = [(p, e) for p, e in sorted(pages.items())]
        if on_card:
            entries.append((387, {'lessons': set(), 'kinds': {'그림카드'}, 'forms': {lemma.lower(), w['w'].lower()}}))
        for p, e in entries:
            first_row.setdefault(w['w'], r_i)
            kinds = '/'.join(sorted(e['kinds'])) or '—'
            is_text = any('글' in k for k in e['kinds']) or p == 387
            src = Image.open(render(p))
            boxes = find(p, e['forms']) if is_text else []
            if is_text and p != 387:
                printed += 1; found += bool(boxes)
            mark = (f'빨간 상자 {len(boxes)}곳' if boxes else ('그림카드 쪽 — 쪽 전체' if p == 387 else '그림 — 쪽 전체' if not is_text
                    else '글자를 못 찾음 — 쪽 전체'))
            ev.append([w['w'], f'p.{p}', ', '.join(f'L{l}' for l in sorted(e['lessons'])) or ('그림카드' if p == 387 else '—'), kinds, mark])
            k = THUMB_H / src.height
            th = boxed(src, boxes, k, 3).resize((round(src.width * k), THUMB_H), Image.Resampling.LANCZOS) if boxes else src.convert('RGB').resize((round(src.width * k), THUMB_H), Image.Resampling.LANCZOS)
            tp = tmp / f'ev{r_i}_page.jpg'; th.save(tp, quality=82)
            img = XLImage(str(tp)); ev.add_image(img, f'F{r_i}'); keep.append(tp); n_imgs += 1
            thumb_w_max = max(thumb_w_max, th.width)
            h_px = THUMB_H
            if boxes:
                # a close-up round the first box at a higher resolution
                x0, y0, x1, y1 = boxes[0]
                bh = y1 - y0
                cx0, cy0 = max(0, x0 - 6 * bh), max(0, y0 - 3 * bh)
                cx1, cy1 = min(src.width, x1 + 6 * bh), min(src.height, y1 + 3 * bh)
                s = 72 / DPI
                zp = doc[p - 1].get_pixmap(dpi=ZOOM_DPI, clip=fitz.Rect(cx0 * s, cy0 * s, cx1 * s, cy1 * s))
                zpath = tmp / f'ev{r_i}_zoom_raw.png'; zp.save(str(zpath))
                z = Image.open(zpath)
                zk = ZOOM_DPI / DPI
                zb = [(bx0 - cx0, by0 - cy0, bx1 - cx0, by1 - cy0) for bx0, by0, bx1, by1 in boxes
                      if bx0 >= cx0 and by0 >= cy0 and bx1 <= cx1 and by1 <= cy1]
                zi = boxed(z, zb, zk, 5)
                fit = min(1.0, 420 / zi.width, THUMB_H / zi.height)
                zi = zi.resize((round(zi.width * fit), round(zi.height * fit)), Image.Resampling.LANCZOS)
                zf = tmp / f'ev{r_i}_zoom.jpg'; zi.save(zf, quality=85)
                zimg = XLImage(str(zf)); ev.add_image(zimg, f'G{r_i}'); keep.append(zf); n_imgs += 1
                zoom_w_max = max(zoom_w_max, zi.width)
            ev.row_dimensions[r_i].height = h_px * 0.75 + 8
            for c in range(1, 6):
                cell = ev.cell(row=r_i, column=c)
                cell.alignment = Alignment(vertical='top', horizontal='center' if c != 5 else 'left', wrap_text=True)
                cell.border = Border(top=thin, bottom=thin, left=thin, right=thin)
            ev.cell(row=r_i, column=1).font = Font(bold=True, size=13)
            r_i += 1
    for c, wdt in enumerate([12, 8, 12, 12, 18, thumb_w_max / 7 + 3, max(zoom_w_max, 120) / 7 + 3], start=1):
        ev.column_dimensions[get_column_letter(c)].width = wdt
    ev.freeze_panes = 'B5'
    # each word's row on the first sheet links to its first evidence row
    for i, (w, lemma, pages, on_card) in enumerate(words, start=5):
        cell = ws.cell(row=i, column=10)
        if w['w'] in first_row:
            n = len(pages) + (1 if on_card else 0)
            cell.value = f'보기 ({n}쪽)'
            cell.hyperlink = Hyperlink(ref=cell.coordinate, location=f"'증빙 화면'!A{first_row[w['w']]}", display=cell.value)
            cell.font = Font(color='3366CC', underline='single')
        else:
            cell.value = '—'
    stats = (r_i - 5, n_imgs, printed, found)

out = ROOT / 'docs' / 'word_sources.xlsx'
out.parent.mkdir(exist_ok=True)
wb.save(out)
m = sum(r[0] == 'm단어' for r in rows)
print(f'{out} · {len(rows)} words (m {m}, other {len(rows) - m}) · kinds seen {sorted({k for d in unit1.values() for e in d.values() for k in e["kinds"]})}')
if stats:
    print(f'evidence rows {stats[0]} · images {stats[1]} · printed occurrences {stats[2]}, word found by OCR on {stats[3]} · {out.stat().st_size / 1e6:.1f} MB')
    shutil.rmtree(tmp, ignore_errors=True)
else:
    for r in rows:
        print(' | '.join(str(x) for x in r))
