# coding: utf-8
"""Read only document.xml from DOCX; cap expansion and reject malformed archives."""
import sys, zipfile, xml.etree.ElementTree as ET
with zipfile.ZipFile(sys.argv[1]) as archive:
    entry = archive.getinfo('word/document.xml')
    if entry.file_size > 20 * 1024 * 1024:
        raise ValueError('Document is too large')
    data = archive.read(entry)
    if b'<!DOCTYPE' in data or b'<!ENTITY' in data:
        raise ValueError('DTD is not supported')
    root = ET.fromstring(data)
    ns = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
    paragraphs = []
    for paragraph in root.iter(ns + 'p'):
        value = ''.join((node.text or '') if node.tag == ns + 't' else '\t' if node.tag == ns + 'tab' else '\n' if node.tag == ns + 'br' else '' for node in paragraph.iter())
        if value.strip():
            paragraphs.append(value.strip())
    sys.stdout.write('\n\n'.join(paragraphs))
