"""SMTP transport; credentials come only from the server environment."""
import json
import os
import smtplib
import ssl
import sys
from email.message import EmailMessage
from email.utils import formatdate


def send(payload):
    message = EmailMessage()
    for key, value in {'From': os.environ['SMTP_FROM'], 'To': payload['to'],
                       'Subject': payload['subject'], 'Message-ID': payload['messageId']}.items():
        message[key] = value
    message['Date'] = formatdate(localtime=False, usegmt=True)
    message.set_content(payload['text'])
    message.add_alternative(payload['html'], subtype='html')
    host = os.environ['SMTP_HOST']
    port = int(os.environ.get('SMTP_PORT', '465'))
    context = ssl.create_default_context()
    secure = os.environ.get('SMTP_SECURE', 'true').lower() != 'false'
    if secure:
        client = smtplib.SMTP_SSL(host, port, timeout=20, context=context)
    else:
        client = smtplib.SMTP(host, port, timeout=20)
    with client:
        if not secure:
            client.starttls(context=context)
        client.login(os.environ['SMTP_USER'], os.environ['SMTP_PASSWORD'])
        client.send_message(message)


if __name__ == '__main__':
    try:
        send(json.load(sys.stdin))
    except Exception:
        # Neither credentials nor email contents belong in application logs.
        sys.exit(1)
