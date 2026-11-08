"""Builds data/fedramp.json: the KSI list (name, theme, statements, class optionality) and the FedRAMP rules
that apply to 20x providers, from the Crosswalk 20x reference bundle (itself built from FedRAMP/rules).
Usage: python3 -I build/make_data.py <crosswalk reference.json> <out.json>"""
import json, sys, re
ref = json.load(open(sys.argv[1]))
ksi = {}
for k, v in ref['ksi'].items():
    st = v['st']
    optional_b = ('b' in st) and st['b'].lower().startswith('**optional')
    ksi[k] = {'name': v['name'], 'theme': v['theme'],
              'statement': st.get('*') or st.get('c') or next(iter(st.values())),
              'optionalInB': optional_b, 'controls': v['controls']}
def applies(r, cls):
    C = cls.upper()
    return (r['bucket'] in ('all', '20x') and 'Providers' in r['affects'] and (not r['types'] or '20x' in r['types'])
            and (not r['classes'] or C in r['classes']) and ('*' in r['st'] or cls in r['st']))
frr = []
for rid, r in ref['frr'].items():
    cl = [c for c in 'bcd' if applies(r, c)]
    if not cl: continue
    st = r['st'].get('*') or r['st'].get('c') or r['st'].get('b') or r['st'].get('d') or ''
    frr.append({'id': rid, 'name': r['name'], 'set': r['set'], 'classes': cl, 'statement': re.sub(r'\s+', ' ', st)[:400]})
frr.sort(key=lambda x: x['id'])
out = {'rulesVersion': ref['rulesVersion'], 'rulesUpdated': ref['rulesUpdated'], 'ksi': ksi, 'frr': frr}
json.dump(out, open(sys.argv[2], 'w'), separators=(',', ':'), ensure_ascii=False)
print('ksi', len(ksi), 'optional in B', sum(1 for k in ksi.values() if k['optionalInB']), 'frr', len(frr), {c: sum(1 for r in frr if c in r['classes']) for c in 'bcd'})
