/** Only the provider-signed parameters are carried through login and consent. */
export function oauthQuery(search=location.search){
 const params=new URLSearchParams(search),nested=params.get('oauth_query');
 if(nested)return nested;
 if(!params.has('sig'))return '';
 const names=new Set(['sig','ba_param',...params.getAll('ba_param')]);
 return new URLSearchParams([...params].filter(([key])=>names.has(key))).toString();
}
