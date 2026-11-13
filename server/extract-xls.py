"""Read stored XLS values only; never execute formulas, macros or external links."""
import json
import os
import sys
import xlrd

if os.path.getsize(sys.argv[1]) > 20 * 1024**2:
    raise ValueError('Workbook too large')

def column_name(index):
    result = ''
    while index:
        index, remainder = divmod(index - 1, 26)
        result = chr(65 + remainder) + result
    return result

count = length = 0
workbook = []
with xlrd.open_workbook(sys.argv[1], on_demand=True, ragged_rows=True) as book:
    if book.nsheets > 256:
        raise ValueError('Too many sheets')
    for sheet_index in range(book.nsheets):
        sheet = book.sheet_by_index(sheet_index)
        rows = []
        workbook.append({'name': sheet.name, 'rows': rows})
        for row_index in range(sheet.nrows):
            cells = []
            for col_index, cell in enumerate(sheet.row(row_index)):
                value = cell.value
                if cell.ctype in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK):
                    continue
                if cell.ctype == xlrd.XL_CELL_DATE:
                    value = xlrd.xldate_as_datetime(value, book.datemode).isoformat(sep=' ')
                elif cell.ctype == xlrd.XL_CELL_BOOLEAN:
                    value = 'Да' if value else 'Нет'
                elif cell.ctype == xlrd.XL_CELL_ERROR:
                    value = xlrd.error_text_from_code.get(value, 'Ошибка ячейки')
                elif cell.ctype == xlrd.XL_CELL_NUMBER:
                    value = str(int(value)) if value == int(value) else str(value)
                else:
                    value = str(value)
                if value:
                    cells.append({'coordinate': column_name(col_index + 1) + str(row_index + 1), 'value': value})
            if cells:
                text = 'Лист «' + sheet.name + '», строка ' + str(row_index + 1) + '\n' + ' | '.join(c['coordinate'] + ': ' + c['value'] for c in cells)
                count += 1
                length += len(text)
                if count > 10000 or length > 10 * 1024**2:
                    raise ValueError('Workbook text too large')
                if '--json' in sys.argv:
                    rows.append({'number': row_index + 1, 'cells': cells})
                else:
                    sys.stdout.write(text + '\n\n')
        book.unload_sheet(sheet_index)
if '--json' in sys.argv:
    sys.stdout.write(json.dumps(workbook, ensure_ascii=False))
