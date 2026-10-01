"""Enumerate every Prisma relation that references User.

Two directions matter and they are not the same thing:

  the User model's own relation fields  -- what the user "has"
  other models' relations TO User       -- the FOREIGN KEYS that actually
                                           constrain a delete

The second list is the one deletion has to answer for. For each, the onDelete
behaviour is reported, because a relation with no explicit onDelete uses
Prisma's default and that default is what decides whether a delete cascades,
restricts or nulls.
"""
import io
import re

SCHEMA = 'C:/tmp/apex-canon/backend/prisma/schema.prisma'
src = io.open(SCHEMA, encoding='utf-8').read()

models = {}
for m in re.finditer(r'^model (\w+) \{(.*?)^\}', src, re.S | re.M):
    models[m.group(1)] = m.group(2)

print('MODELS: %d' % len(models))
print()

# ── relations TO User, from every other model ─────────────────────────────
print('=' * 78)
print('FOREIGN KEYS POINTING AT User  (what constrains a delete)')
print('=' * 78)
rows = []
for name, body in sorted(models.items()):
    if name == 'User':
        continue
    for line in body.splitlines():
        s = line.strip()
        if not s or s.startswith('//') or s.startswith('/'):
            continue
        # a relation field whose type is User / User? / User[]
        m = re.match(r'^(\w+)\s+User(\[\]|\?)?\s*(.*)$', s)
        if not m:
            continue
        field, suffix, rest = m.group(1), m.group(2) or '', m.group(3)
        fk = re.search(r'fields:\s*\[([^\]]+)\]', rest)
        od = re.search(r'onDelete:\s*(\w+)', rest)
        rel = re.search(r'@relation\("([^"]+)"', rest)
        rows.append({
            'model': name,
            'field': field + suffix,
            'fk': fk.group(1).strip() if fk else '',
            'onDelete': od.group(1) if od else '(default)',
            'named': rel.group(1) if rel else '',
        })

for r in rows:
    print('  %-32s %-26s fk=%-24s onDelete=%-12s %s'
          % (r['model'], r['field'], r['fk'] or '-', r['onDelete'], r['named']))
print()
print('  total FK relations to User: %d across %d models'
      % (len(rows), len({r['model'] for r in rows})))
print()

# ── onDelete distribution: the risk summary ───────────────────────────────
from collections import Counter
print('=' * 78)
print('onDelete DISTRIBUTION  (a cascade is a shared record that disappears)')
print('=' * 78)
for behaviour, n in Counter(r['onDelete'] for r in rows).most_common():
    print('  %-14s %d' % (behaviour, n))
    for r in rows:
        if r['onDelete'] == behaviour:
            print('      %s.%s' % (r['model'], r['field']))
print()

# ── which FK columns are nullable (can be nulled instead of deleted) ──────
print('=' * 78)
print('NULLABILITY OF THE FK COLUMN  (decides RETAIN_AND_NULL_ACTOR viability)')
print('=' * 78)
for r in rows:
    if not r['fk']:
        print('  %-32s %-24s (implicit / no scalar fk)' % (r['model'], r['field']))
        continue
    cols = [c.strip() for c in r['fk'].split(',')]
    body = models[r['model']]
    for col in cols:
        dm = re.search(r'^\s+' + re.escape(col) + r'\s+(\S+)', body, re.M)
        typ = dm.group(1) if dm else '?'
        print('  %-32s %-24s %-22s %s'
              % (r['model'], r['field'], col, 'NULLABLE' if typ.endswith('?') else 'REQUIRED'))
