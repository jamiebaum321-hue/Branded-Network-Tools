"""Return bounded, named contact records from a client-designated CSV or XLSX list."""
import csv
import io
import itertools
import json
import re
import sys
import zipfile
from xml.etree import ElementTree

MAX_XML = 6 * 1024 * 1024
MAX_ROWS = 250
NAMESPACE = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
ALIASES = {
    "company": ("company", "company name", "account", "account name", "organization", "partner", "target company"),
    "person": ("person", "contact", "contact name", "full name", "partner contact", "name"),
    "first_name": ("first name", "firstname", "given name"),
    "last_name": ("last name", "lastname", "surname", "family name"),
    "email": ("email", "email address", "work email", "business email"),
    "phone": ("phone", "telephone", "phone number", "mobile phone", "business phone"),
    "title": ("title", "job title", "position"),
    "department": ("department", "function", "team", "business function"),
    "notes": ("notes", "note", "contact notes", "relationship", "reason", "description"),
}
FIELDS = {alias: key for key, names in ALIASES.items() for alias in names}
LIMITS = {"company": 180, "person": 150, "first_name": 100, "last_name": 100, "email": 254,
          "phone": 70, "title": 150, "department": 100, "notes": 1000}


def xml_part(book, name):
    item = book.getinfo(name)
    if item.file_size > MAX_XML:
        raise ValueError("large sheet")
    data = book.read(item)
    if b"<!doctype" in data.lower() or b"<!entity" in data.lower() or b"\0" in data:
        raise ValueError("unsupported XML")
    return ElementTree.fromstring(data)


def sheets(data):
    with zipfile.ZipFile(io.BytesIO(data)) as book:
        strings = []
        if "xl/sharedStrings.xml" in book.namelist():
            strings = ["".join(t.text or "" for t in entry.iter(NAMESPACE + "t"))
                       for entry in xml_part(book, "xl/sharedStrings.xml")]
        names = sorted(n for n in book.namelist() if re.fullmatch(r"xl/worksheets/sheet[0-9]+\.xml", n))
        for name in names[:8]:
            sheet = xml_part(book, name)
            def rows():
                for row in sheet.iter(NAMESPACE + "row"):
                    values = [""] * 100
                    for cell in row.iterfind(NAMESPACE + "c"):
                        col = re.match(r"^[A-Z]{1,3}", cell.get("r", ""))
                        if not col:
                            continue
                        index = 0
                        for char in col[0]:
                            index = index * 26 + ord(char) - 64
                        if index > len(values):
                            continue
                        value = cell.findtext(NAMESPACE + "v", "")
                        if cell.get("t") == "s":
                            value = strings[int(value)] if value.isdigit() and int(value) < len(strings) else ""
                        elif cell.get("t") == "inlineStr":
                            value = "".join(t.text or "" for t in cell.iter(NAMESPACE + "t"))
                        values[index - 1] = value
                    yield values
            yield rows()


def csv_rows(data):
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        text = data.decode("utf-16")
    else:
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = data.decode("cp1252")
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    return csv.reader(io.StringIO(text, newline=""), dialect)


def read_list(data, extension, purpose):
    tables = sheets(data) if extension == ".xlsx" else [csv_rows(data)]
    result = []
    for rows in tables:
        columns = None
        for number, row in enumerate(itertools.islice(rows, MAX_ROWS + 12)):
            if columns is None:
                header = [FIELDS.get(re.sub(r"[\W_]+", " ", val.lower()).strip()) for val in row[:100]]
                wanted = {"person", "first_name", "last_name", "email"} if purpose == "team" else {"company", "person"}
                if wanted.intersection(header):
                    columns = header
                elif number >= 9:
                    break
                continue
            record = {field: str(value).strip()[:LIMITS[field]] for field, value in zip(columns, row)
                      if field and value and str(value).strip()}
            if purpose == "team":
                if not record.get("first_name") and not record.get("last_name") and record.get("person"):
                    first, _, last = record["person"].partition(" ")
                    record.update(first_name=first[:100], last_name=last[:100])
                if not any(record.get(k) for k in ("first_name", "last_name", "email")):
                    continue
            else:
                record["contact"] = record.get("person") or " ".join(record[k] for k in ("first_name", "last_name") if record.get(k))
                if not record.get("company") and not record["contact"]:
                    continue
            result.append(record)
            if len(result) > MAX_ROWS:
                return {"rows": result[:MAX_ROWS], "limited": True}
    return {"rows": result, "limited": False}


if __name__ == "__main__":
    try:
        parsed = read_list(sys.stdin.buffer.read(), sys.argv[1], sys.argv[2])
    except (OSError, ValueError, KeyError, csv.Error, zipfile.BadZipFile, ElementTree.ParseError, RuntimeError, NotImplementedError):
        parsed = {"rows": [], "limited": False}
    print(json.dumps(parsed, ensure_ascii=True))
