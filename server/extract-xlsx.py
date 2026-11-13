# coding: utf-8
"""Extract stored spreadsheet values with sheet/row/cell coordinates, without evaluating formulas."""
import sys,zipfile,posixpath,datetime,json
import xml.etree.ElementTree as ET
N='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
R='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
with zipfile.ZipFile(sys.argv[1]) as z:
    total=[0]
    def xml(path):
        info=z.getinfo(path)
        total[0]+=info.file_size
        if info.file_size>20*1024*1024 or total[0]>50*1024*1024:raise ValueError('Expanded workbook too large')
        data=z.read(path)
        if b'<!DOCTYPE' in data or b'<!ENTITY' in data:raise ValueError('DTD is not supported')
        return ET.fromstring(data)
    book=xml('xl/workbook.xml')
    relations={e.attrib['Id']:posixpath.normpath('xl/'+e.attrib['Target']).replace('xl/xl/','xl/') for e in xml('xl/_rels/workbook.xml.rels') if e.attrib.get('TargetMode')!='External'}
    for key,value in list(relations.items()):
        if value.startswith('xl/') is False:relations[key]=value.lstrip('/')
    strings=[]
    if 'xl/sharedStrings.xml' in z.namelist():strings=[''.join(si.itertext()) for si in xml('xl/sharedStrings.xml')]
    custom={}; styles=[]
    if 'xl/styles.xml' in z.namelist():
        st=xml('xl/styles.xml');fmts=st.find(N+'numFmts');custom={int(e.attrib['numFmtId']):e.attrib.get('formatCode','') for e in fmts} if fmts is not None else {}
        xfs=st.find(N+'cellXfs');styles=[int(e.attrib.get('numFmtId',0)) for e in xfs] if xfs is not None else []
    props=book.find(N+'workbookPr');epoch=datetime.datetime(1904,1,1) if props is not None and props.attrib.get('date1904')=='1' else datetime.datetime(1899,12,30)
    count=0;length=0;workbook=[]
    for sheet in book.find(N+'sheets'):
        preview_rows=[]
        workbook.append({'name':sheet.attrib.get('name',''),'rows':preview_rows})
        path=relations.get(sheet.attrib.get(R+'id'))
        if not path or path.startswith('../') or path.startswith('/'):raise ValueError('Invalid sheet path')
        sheet_xml=xml(path)
        for row in sheet_xml.iter(N+'row'):
            cells=[];preview_cells=[]
            for cell in row.findall(N+'c'):
                coord=cell.attrib.get('r','?');kind=cell.attrib.get('t');node=cell.find(N+'v');value=node.text if node is not None and node.text else ''
                if kind=='s':value=strings[int(value)] if value else ''
                elif kind=='inlineStr':value=''.join(cell.find(N+'is').itertext()) if cell.find(N+'is') is not None else ''
                elif kind=='b':value='Да' if value=='1' else 'Нет'
                elif value and kind not in ['str','e']:
                    fmt=styles[int(cell.attrib.get('s',0))] if int(cell.attrib.get('s',0))<len(styles) else 0
                    if fmt in range(14,23) or fmt in [45,46,47]:
                        try:value=(epoch+datetime.timedelta(days=float(value))).isoformat(sep=' ')
                        except ValueError:pass
                    elif fmt in [9,10] or '%' in custom.get(fmt,''):
                        try:value=str(round(float(value)*100,8))+' %'
                        except ValueError:pass
                formula=cell.find(N+'f')
                if formula is not None:value=(value or 'нет сохранённого результата')+' [формула: '+(formula.text or '')+']'
                if value:
                    cells.append(coord+': '+value)
                    preview_cells.append({'coordinate':coord,'value':value})
            if cells:
                text='Лист «'+sheet.attrib.get('name','')+'», строка '+row.attrib.get('r','?')+'\n'+' | '.join(cells)
                length+=len(text);count+=1
                if length>10*1024*1024 or count>10000:raise ValueError('Workbook text too large')
                if '--json' in sys.argv:preview_rows.append({'number':int(row.attrib.get('r','0')),'cells':preview_cells})
                else:sys.stdout.write(text+'\n\n')
    if '--json' in sys.argv:sys.stdout.write(json.dumps(workbook,ensure_ascii=False))
