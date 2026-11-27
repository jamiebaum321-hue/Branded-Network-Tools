import io
import textwrap


report_headings = {'Goals and deliverables', 'Completed and outcomes', 'Outstanding work', 'Introductions and next steps',
                   'Connection updates', 'Project milestones', 'Client notes', 'Intake and files', 'Pipeline changes'}


def report_lines(report):
    # The exported document already displays the generated title and date range.
    prefix = f"{report['client']} · Weekly update\n\n{report['start_day']} to {report['end_day']}\n\n"
    return report['body'].replace('\r\n', '\n').removeprefix(prefix).splitlines()


def workbook(report):
    import xlsxwriter

    buffer = io.BytesIO()
    with xlsxwriter.Workbook(buffer, {'in_memory': True}) as book:
        book.set_properties({'title': 'Weekly client update', 'author': 'Branded Network Tools'})
        sheet = book.add_worksheet('Weekly update')
        sheet.hide_gridlines(2)
        sheet.set_column(0, 0, 94)
        sheet.set_landscape()
        sheet.fit_to_pages(1, 0)
        sheet.set_header('&LBranded Network')
        sheet.set_footer('&RPage &P of &N')
        title = book.add_format({'bold': True, 'font_size': 18, 'font_color': '#142540', 'text_wrap': True})
        period = book.add_format({'font_color': '#465772', 'italic': True})
        heading = book.add_format({'bold': True, 'font_color': '#2753C7', 'bg_color': '#EEF2FA'})
        item = book.add_format({'text_wrap': True, 'valign': 'top'})
        client_title = report['client'] + ' · Weekly update'
        sheet.write_string(0, 0, client_title, title)
        sheet.set_row(0, max(32, 25 * len(textwrap.wrap(client_title, width=53))))
        sheet.write_string(1, 0, f"{report['start_day']} to {report['end_day']}", period)
        sheet.freeze_panes(2, 0)
        row = 3
        for line in report_lines(report):
            if not line.strip():
                sheet.set_row(row, 8)
                row += 1
                continue
            # Keep long narrative entries readable within Excel's row-height limit.
            for chunk in textwrap.wrap(line, width=900, replace_whitespace=False, drop_whitespace=False,
                                       expand_tabs=False, break_on_hyphens=False):
                sheet.write_string(row, 0, chunk, heading if line in report_headings else item)
                sheet.set_row(row, max(21, 16 * len(textwrap.wrap(chunk, width=82)) + 4))
                row += 1
    return buffer.getvalue()
