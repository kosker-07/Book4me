/* Early theme selection without inline scripts; compliant with script-src self. */
(()=>{try{const v=localStorage.getItem("b4b-theme");document.documentElement.dataset.theme=v==="light"||v==="dark"?v:"auto"}catch{document.documentElement.dataset.theme="auto"}})();
