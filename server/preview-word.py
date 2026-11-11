# coding: utf-8
"""Passive DOCX preview. No remote resources, relationships, scripts or document HTML."""
import sys, zipfile, html, xml.etree.ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
def render(node):
    tag = node.tag.removeprefix(W)
    if tag == 't': return html.escape(node.text or '')
    if tag == 'tab': return '    '
    if tag in ('br', 'cr'): return '<br>'
    if tag in ('pPr', 'rPr', 'tblPr', 'tcPr', 'sectPr'): return ''
    content = ''.join(render(child) for child in node)
    if tag == 'r':
        props = node.find(W+'rPr')
        if props is not None:
            for prop, wrapper in [('b','strong'),('i','em'),('u','u')]:
                value=props.find(W+prop)
                if value is not None and value.get(W+'val') not in ('0','false','none'):
                    content='<'+wrapper+'>'+content+'</'+wrapper+'>'
    if tag == 'p':
        style=node.find('./'+W+'pPr/'+W+'pStyle')
        value=(style.get(W+'val','') if style is not None else '').lower()
        heading=next((n for n in range(1,7) if value in ('heading'+str(n),'заголовок'+str(n))),None)
        container='h'+str(heading) if heading else 'p'
        if node.find('./'+W+'pPr/'+W+'numPr') is not None: content='• '+content
        return '<'+container+'>'+content+'</'+container+'>'
    if tag in ('tbl','tr','tc'):
        container={'tbl':'table','tr':'tr','tc':'td'}[tag]
        return '<'+container+'>'+content+'</'+container+'>'
    return content

with zipfile.ZipFile(sys.argv[1]) as archive:
    entry=archive.getinfo('word/document.xml')
    if entry.file_size > 20*1024*1024: raise ValueError('Document is too large')
    data=archive.read(entry)
    if b'<!DOCTYPE' in data or b'<!ENTITY' in data: raise ValueError('DTD is not supported')
    root=ET.fromstring(data)
    body=root.find(W+'body')
    if body is None: raise ValueError('Missing document body')
    sys.stdout.write(render(body))
