import { fullFieldSpecs } from '../apps/extension/src/full-profile.js';

export function fullFixtureHtml({ radioDefaults = true } = {}) {
  const control = fullFieldSpecs
    .map((s) => {
      if (s.kind === 'radio')
        return `<fieldset>${s.options!.map((value, i) => `<label for="${s.key}-${i}">${value}</label><input style="opacity:0" id="${s.key}-${i}" type="radio" name="${s.key === 'cardDesign' ? 'color' : 'material'}-fixture" value="${i}" ${radioDefaults && i === 0 ? 'checked' : ''}>`).join('')}</fieldset>`;
      // Fixed public structure observed in the live telephone widgets (no user values).
      const label =
        `<label for="${s.key}">${s.label} *</label>` +
        ([
          'businessZipCode',
          'zipCode',
          'businessPhoneNumber',
          'cellPhone',
        ].includes(s.key)
          ? `<label for="${s.key}"></label>`
          : '');
      if (s.kind === 'select')
        return (
          label +
          `<select id="${s.key}" name="${s.key}"><option value="">Choose one</option>${s.options!.map((text, i) => `<option value="${s.key === 'state' || s.key === 'businessState' ? text : String(i + 1)}">${text}</option>`).join('')}</select>`
        );
      return (
        label +
        `<input id="${s.key}" name="${s.key}" type="${s.kind}" ${s.combobox ? 'role="combobox" aria-controls="address-list"' : ''} ${s.kind === 'checkbox' ? 'style="opacity:0"' : ''}>`
      );
    })
    .join('');
  return `<!doctype html><meta charset="utf-8"><style>label,input,select{display:block;margin:5px}body{width:700px}</style><form>${control}<button id="submit" type="submit">Submit</button></form><script>
  window.submissions=0; document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();window.submissions++});
  document.getElementById('companyStructure').addEventListener('change',e=>{const tax=document.getElementById('federalTaxId');tax.hidden=e.target.selectedOptions[0].text==='Sole Proprietorship';});
  document.getElementById('doingBusinessAs').addEventListener('change',e=>document.getElementById('companyDBAName').disabled=e.target.checked);
  document.getElementById('sameAddress').addEventListener('change',e=>{for(const key of ['addressLine1','addressLine2','zipCode','city','state'])document.getElementById(key).disabled=e.target.checked;});
  for(const key of ['businessPhoneNumber','cellPhone'])document.getElementById(key).addEventListener('blur',e=>{const v=e.target.value;if(/^\\d{10}$/.test(v))e.target.value='('+v.slice(0,3)+') '+v.slice(3,6)+'-'+v.slice(6);});
  document.getElementById('ssn').addEventListener('blur',e=>{const v=e.target.value;if(/^\\d{9}$/.test(v))e.target.value=v.slice(0,3)+'-'+v.slice(3,5)+'-'+v.slice(5);});
  </script>`;
}
