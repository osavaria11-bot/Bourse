"""Seal committee JSON and PDF for the owner's browser. Publication needs only a public key."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

INFO=b'SAVY committee v1'
SECTIONS=('summary','os','jmc','mcl','comparison','optimization','recommendations','follow_up','outlook','methodology')
def b64(data):return base64.urlsafe_b64encode(data).decode().rstrip('=')
def unb64(value):return base64.urlsafe_b64decode(value+'='*(-len(value)%4))
def compact(value):return json.dumps(value,ensure_ascii=False,separators=(',',':')).encode()
def public_jwk(key):
    if key.get('kty')!='EC' or key.get('crv')!='P-256':raise ValueError('Unsupported public key')
    if 'd' in key:raise ValueError('A private key must never be passed to the publisher')
    if any(len(unb64(key[name]))!=32 for name in ('x','y')):raise ValueError('Invalid public key')
    return {'crv':'P-256','kty':'EC','x':key['x'],'y':key['y']}
def fingerprint(key):return 'p256:'+b64(hashlib.sha256(compact(public_jwk(key))).digest())
def seal(report,pdf,recipient):
    from datetime import date
    day=report.get('date','');date.fromisoformat(day)
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',day) or report.get('schema_version')!=1:raise ValueError('Invalid report date/schema')
    if any(not isinstance(report.get('sections',{}).get(key),str) or not report['sections'][key].strip() for key in SECTIONS):raise ValueError('All ten analyses must be provided')
    if sum(len(s) for s in report['sections'].values())>250000 or len(pdf)>15000000 or not pdf.startswith(b'%PDF-'):raise ValueError('Invalid report/PDF size or format')
    pub=public_jwk(recipient['public_key']);key_id=fingerprint(pub)
    if key_id!=recipient['key_id']:raise ValueError('Public key identity mismatch')
    target=ec.EllipticCurvePublicNumbers(int.from_bytes(unb64(pub['x']),'big'),int.from_bytes(unb64(pub['y']),'big'),ec.SECP256R1()).public_key()
    ephemeral=ec.generate_private_key(ec.SECP256R1());numbers=ephemeral.public_key().public_numbers()
    epk={'crv':'P-256','kty':'EC','x':b64(numbers.x.to_bytes(32,'big')),'y':b64(numbers.y.to_bytes(32,'big'))}
    salt=os.urandom(32);iv=os.urandom(12)
    shared=ephemeral.exchange(ec.ECDH(),target)
    aes=HKDF(algorithm=hashes.SHA256(),length=32,salt=salt,info=INFO).derive(shared)
    payload={'schema_version':1,'report':report,'pdf_base64':b64(pdf),'pdf_sha256':b64(hashlib.sha256(pdf).digest())}
    encrypted=AESGCM(aes).encrypt(iv,compact(payload),INFO+b'|'+day.encode()+b'|'+key_id.encode())
    return {'schema_version':1,'kind':'savy-committee-encrypted','algorithm':'ECDH-P256-HKDF-SHA256-AES256GCM','date':day,'recipient':key_id,'ephemeral':epk,'salt':b64(salt),'iv':b64(iv),'ciphertext':b64(encrypted)}
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--report',required=True);parser.add_argument('--pdf',required=True);parser.add_argument('--public-key',default='data/committee-public-key.json');parser.add_argument('--output-dir',default='data');args=parser.parse_args()
    report=json.loads(Path(args.report).read_text());recipient=json.loads(Path(args.public_key).read_text());envelope=seal(report,Path(args.pdf).read_bytes(),recipient)
    root=Path(args.output_dir);folder=root/'committee';folder.mkdir(parents=True,exist_ok=True);path=folder/(report['date']+'.json');raw=compact(envelope)+b'\n';path.write_bytes(raw)
    index_path=root/'committee-reports.json';index=json.loads(index_path.read_text()) if index_path.exists() else {'schema_version':1,'editions':[]}
    edition={'date':report['date'],'path':'data/committee/'+report['date']+'.json','recipient':envelope['recipient'],'sha256':b64(hashlib.sha256(raw).digest())}
    previous={item['date']:item for item in index['editions']};previous[report['date']]=edition
    index={'schema_version':1,'editions':sorted(previous.values(),key=lambda item:item['date'],reverse=True)}
    index_path.write_bytes(compact(index)+b'\n')
    print(json.dumps({'date':report['date'],'encrypted_file':str(path),'encrypted_bytes':len(raw),'edition_count':len(index['editions']),'sections':len(report['sections'])}))
if __name__=='__main__':main()
