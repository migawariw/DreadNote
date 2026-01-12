// 0️⃣ モジュールのインポート
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut, getRedirectResult } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getDocs, getFirestore, collection, addDoc, doc, setDoc, getDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

//1️⃣ Firebase 初期化・キャッシュ
// RAMに一時的に保存（リロードで消える）
let metaCache = null;        // ← 目次箱
const memoCache = {};       // ← 本文キャッシュ

// firebase
const firebaseConfig = { apiKey: "AIzaSyCdDf0GH80PoGlcbk2yjlaVQfP01Gk9m18", authDomain: "noteeditor-ba1db.firebaseapp.com", projectId: "noteeditor-ba1db" };
// ✅ 呼び出しの可能性あり（内部で軽くプロジェクト確認など）
const app = initializeApp( firebaseConfig );
// ❌ ローカルオブジェクト作成のみ → 通信なし
const auth = getAuth( app );
// ❌ ローカルオブジェクト作成のみ → 通信なし
const db = getFirestore( app );
// ✅ 確実に呼び出し発生（サーバーに問い合わせて認証確認）
getRedirectResult( auth ).catch( () => { } );

/* 2️⃣DOM要素格納 このブロックはFirebaseへの通信無し*/
// すなわちHTML内の各要素（ログイン画面、一覧画面、ゴミ箱画面、エディター画面）を変数に格納する
const views = {
	login: document.getElementById( 'view-login' ),
	list: document.getElementById( 'view-list' ) || document.querySelector( '#sidebar #view-list' ),
	trash: document.getElementById( 'view-trash' ),
	editor: document.getElementById( 'view-editor' )
};
//メモ一覧、ゴミ箱、エディター、ユーザーアイコン、メニュー等を表示する要素を取得している
const memoList = document.getElementById( 'memo-list' );
const trashList = document.getElementById( 'trash-list' );
const editor = document.getElementById( 'editor' );
editor.contentEditable = 'true';

const userIcon = document.getElementById( 'user-icon' );
const userMenu = document.getElementById( 'user-menu' );
const fontBtn = document.getElementById( 'font-size-btn' );
const fontPopup = document.getElementById( 'font-size-popup' );
const fontSlider = document.getElementById( 'font-size-slider' );
const fontValue = document.getElementById( 'font-size-value' );
const editorEl = document.getElementById( 'editor' );
const toast = document.getElementById( 'toast' );
const darkBtn = document.getElementById( 'dark-btn' );
const spreadBtn = document.getElementById( 'spread-btn' );

const sidebar = document.getElementById( 'sidebar' );
const sidebarToggle = document.getElementById( 'sidebar-toggle' );
const sidebarToggle2 = document.getElementById( 'sidebar-toggle2' );

sidebarToggle.onclick = async () => {
	sidebar.classList.toggle( 'show' );

	// サイドバーを開いたらメモ一覧をロード

	if ( sidebar.classList.contains( 'show' ) ) {
		await loadMetaOnce();   // まず metaCache をロード
		await loadMemos();      // メモ一覧を描画
	}
};
function closeSidebar() {
	sidebar.classList.remove( 'show' );
}

// サイドバー閉じるボタン
sidebarToggle2.onclick = async () => {
	await flushSave();
	closeSidebar();
};

editor.addEventListener( 'blur', () => {
	setTimeout( () => {
		editor.contentEditable = 'false';
	}, 0 );
} );
document.addEventListener( 'click', ( e ) => {
	if ( sidebar.classList.contains( 'show' ) && !sidebar.contains( e.target ) && e.target !== sidebarToggle ) {
		sidebar.classList.remove( 'show' );
	}
} );

document.addEventListener( 'touchstart', ( e ) => {
	if ( sidebar.classList.contains( 'show' ) && !sidebar.contains( e.target ) && e.target !== sidebarToggle ) {
		sidebar.classList.remove( 'show' );
	}
} );

// PC: クリックで編集開始
editor.addEventListener( 'mousedown', e => {
	// 長押しやリンククリックは除外
	if ( e.target.closest( 'a' ) || e.target.closest( 'img' ) || e.target.closest( 'iframe' ) ) return;

	if ( editor.contentEditable === 'false' ) {
		editor.contentEditable = 'true';

		const x = e.clientX;
		const y = e.clientY;
		const range = document.caretRangeFromPoint( x, y );
		if ( range ) {
			const sel = window.getSelection();
			sel.removeAllRanges();
			sel.addRange( range );
		}

		editor.focus( { preventScroll: true } );
	}
} );

// 3️⃣UI操作（フォント、ダークモードなど）
let lastScrollY = window.scrollY;
const toggleBtn = document.getElementById( 'sidebar-toggle' );

window.addEventListener( 'scroll', () => {
	const currentScrollY = window.scrollY;

	if ( currentScrollY <= 0 ) {
		// ページ最上部 → 必ず表示
		toggleBtn.classList.remove( 'hide' );
	} else if ( currentScrollY > lastScrollY ) {
		// 下スクロール → 表示
		toggleBtn.style.transition = 'transform 0.7s ease, opacity 0.7s ease'; // ゆっくり出現
		toggleBtn.classList.add( 'hide' );
	} else if ( currentScrollY < lastScrollY ) {
		// 上スクロール → 隠す
		toggleBtn.classList.remove( 'hide' );
	}

	lastScrollY = currentScrollY;
} );
userIcon.onclick = () => { userMenu.style.display = ( userMenu.style.display === 'block' ) ? 'none' : 'block'; }
// Aa押した時の挙動
fontBtn.onclick = e => {
	//ボタンを親要素に影響させない
	e.stopPropagation();
	// スライダーのやつ、fontPopup表示されていれば閉じる、閉じていれば表示する
	fontPopup.style.display = ( fontPopup.style.display === 'block' ) ? 'none' : 'block';
	// 押されたらユーザーメニューを非表示にする
	userMenu.style.display = 'none';
};

// スライダーが確定されたら文字サイズ変更
fontSlider.oninput = e => {
	const size = fontSlider.value + 'px';
	// body全体、に文字サイズを反映
	document.body.style.fontSize = size;
	// editorElはHTMLのid editorのこと
	editorEl.style.fontSize = size;
	//一覧画面もサイズ反映
	memoList.querySelectorAll( 'li' ).forEach( li => {
		li.style.fontSize = size;
	} );
	//スライダーの横の文字も反映
	fontValue.textContent = size;
	//その端末にフォントサイズが残る
	localStorage.setItem( 'dreadnote-font-size', fontSlider.value );
};

// 端末から反映
const savedSize = localStorage.getItem( 'dreadnote-font-size' );
//端末に初期値があればそれにする　ずれの原因これじゃね？まあいいや
if ( savedSize ) {
	editorEl.style.fontSize = savedSize + 'px';
	fontSlider.value = savedSize;
	fontValue.textContent = savedSize + 'px';
	memoList.querySelectorAll( 'li' ).forEach( li => li.style.fontSize = savedSize + 'px' );
}

// ポップアップ外クリックでスライダーとか閉じる
document.addEventListener( 'click', e => {
	if ( !fontPopup.contains( e.target ) && e.target !== fontBtn ) {
		fontPopup.style.display = 'none';
	}
} );


//ダークモードにするかどうかは端末に保存
if ( darkBtn ) {
	darkBtn.onclick = ( e ) => {
		//ボタンを親要素に影響させない
		e.stopPropagation();
		document.body.classList.toggle( 'dark' );
		localStorage.setItem(
			'dreadnote-dark',
			document.body.classList.contains( 'dark' ) ? '1' : '0'
		);
	};
}
// Spread mode toggle（ダークと同様）
if ( spreadBtn ) {
	spreadBtn.onclick = ( e ) => {
		e.stopPropagation();
		document.body.classList.toggle( 'spread' );
		localStorage.setItem(
			'dreadnote-spread',
			document.body.classList.contains( 'spread' ) ? '1' : '0'
		);
	};
}

// 端末から保存状態を反映
if ( localStorage.getItem( 'dreadnote-dark' ) === '1' ) {
	document.body.classList.add( 'dark' );
}
if ( localStorage.getItem( 'dreadnote-spread' ) === '1' ) {
	document.body.classList.add( 'spread' );
}


// 他の場所をクリックしたらメニューが閉じる
document.addEventListener( 'click', e => {
	if ( !userMenu.contains( e.target ) && e.target !== userIcon ) userMenu.style.display = 'none';
	document.querySelectorAll( '.menu-popup' ).forEach( menu => {
		const btn = menu.previousSibling;
		if ( !menu.contains( e.target ) && !btn.contains( e.target ) ) menu.style.display = 'none';
	} );
} );

/* 4️⃣トースト表示（2.000秒間）の関数設定 */
function showToast( msg, d = 2000 ) { toast.textContent = msg; toast.classList.add( 'show' ); setTimeout( () => toast.classList.remove( 'show' ), d ); }
function show( view ) {
	Object.values( views ).forEach( v => { if ( v ) v.hidden = true; } );
	if ( views[view] ) views[view].hidden = false;
}

/* 5️⃣6️⃣ 認証処理（Google ログイン / ログアウト） */
const provider = new GoogleAuthProvider();
provider.setCustomParameters( {
	prompt: 'select_account'
} )

document.getElementById( 'google-login' ).onclick = async () => { try { await signInWithPopup( auth, provider ); } catch ( e ) { showToast( "Googleログイン失敗: " + e.message ); } };

document.getElementById( 'logout-btn' ).onclick = () => { userMenu.style.display = 'none'; metaCache = null; signOut( auth ); location.hash = '#login'; }

// async function openInitialMemo() {
// 	await loadMetaOnce();

// 	// 未編集メモを探す
// 	let unedited = metaCache.memos.find( m => !m.deleted && m.edited === 0 );
// 	let memoId;

// 	if ( unedited ) {
// 		memoId = unedited.id;
// 	} else {
// 		// なければ新規作成
// 		const ref = await addDoc(
// 			collection( db, 'users', auth.currentUser.uid, 'memos' ),
// 			{ title: '', content: '', updated: Date.now(), edited: 0 }
// 		);

// 		metaCache.memos.push( {
// 			id: ref.id,
// 			title: '',
// 			updated: Date.now(),
// 			deleted: false,
// 			edited: 0
// 		} );
// 		await saveMeta();

// 		memoId = ref.id;
// 	}

// 	// 🔒 サイドバーを閉じる
// 	sidebar.classList.remove( 'show' );

// 	location.hash = `#/editor/${memoId}`;
// }

// 認証状態変化時
onAuthStateChanged( auth, async user => {
	document.body.classList.remove( 'auth-loading' );

	if ( !user ) {
		location.hash = '#login';
		show( 'login' );
		return;
	}

	if ( user.photoURL ) userIcon.src = user.photoURL;

	// ✅ まず metaCache をロード
	await loadMetaOnce();
	// await fixSizesOnce();
	fixSizesOnce().then( () => console.log( 'Sizes fixed in background' ) );

	// ✅ ハッシュが #/editor/xxx ならそのまま開く
	if ( location.hash.startsWith( '#/editor/' ) ) {
		await navigate();
	} else {
		// hashが無ければ未編集メモ or 新規作成
		await openNewMemo();
	}
} );
window.addEventListener( 'hashchange', () => {
	if ( !auth.currentUser ) return;
	navigate();
} );

//7️⃣ メモ関連の処理の関数（loadMeta, loadMemos, openEditor, saveMemo, updateMeta など）
// ==========================
// グローバル変数
// ==========================
let saveTimer = null;       // ← これを忘れずに宣言
let currentMemoId = null;
let isNewMemo = false;
let tempNewMemo = null;     // 空の新規メモをローカルに保持

// ==========================
// サイドバーで新規メモ作成
// ==========================
async function openNewMemo() {
    isNewMemo = true;
    currentMemoId = null;
    tempNewMemo = { content: '', title: '' }; // ローカル保持
		creatingMemo = false; // ← ★これを必ず入れる


    location.hash = '#/editor/new';
    await showEditor(tempNewMemo);
    editor.innerHTML = '<div><br></div>';
    editor.contentEditable = 'true';
    editor.focus();
}

// ==========================
// 既存メモを開く
// ==========================
async function openMemo(id) {
    await flushSave(); // 前のメモを保存／削除
    currentMemoId = id;
    isNewMemo = false;
    location.hash = `#/editor/${id}`;
    showEditor();
    editor.innerHTML = memoCache[id]?.content || '<div><br></div>';
    editor.focus();
}

// ==========================
// 入力時処理（新規メモをDBに登録する）
// ==========================


// ==========================
// saveTimer 安全な debounceSave
// ==========================
function debounceSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveMemo, 500);
}

// ==========================
// flushSave: 入力内容を保存して空メモは無理に削除しない
// ==========================
async function flushSave() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
        await saveMemo();

        // editorが空 AND DBに保存済みのNew Memoだけ削除する場合
        if (currentMemoId && (!editor.innerText.trim() || editor.innerHTML === '<div><br></div>')) {
            const m = getMeta(currentMemoId);
            if (m) {
                m.deleted = true;
                m.updated = Date.now();
                await saveMeta();
            }

            // editorリセット
            currentMemoId = null;
            isNewMemo = true;
            editor.innerHTML = '';
        }
				
    }
}
function renderTotalSize() {
	const el = document.getElementById( 'total-size' );
	if ( !el || !metaCache ) return;

	const bytes = metaCache.totalSize;
	el.textContent =
		bytes >= 1024 * 1024
			? ( bytes / ( 1024 * 1024 ) ).toFixed( 2 ) + ' MB'
			: Math.round( bytes / 1024 ) + ' KB';
}
async function loadMetaOnce() {
	if ( metaCache ) return metaCache;

	let metaWasFixed = false;

	const metaRef = doc( db, 'users', auth.currentUser.uid, 'meta', 'main' );
	const snap = await getDoc( metaRef );

	if ( snap.exists() ) {
		metaCache = snap.data();
		if ( !Array.isArray( metaCache.memos ) ) {
			metaCache.memos = [];
			metaWasFixed = true;
		}
	} else {
		metaCache = { memos: [] };
		metaWasFixed = true;
	}

	// 🔁 meta が空なら Firestore から1回だけ復元
	if ( metaCache.memos.length === 0 ) {
		const memosSnap = await getDocs(
			collection( db, 'users', auth.currentUser.uid, 'memos' )
		);

		metaCache.memos = memosSnap.docs.map( d => {
			const m = d.data();
			return {
				id: d.id,
				title: m.title || '',
				updated: m.updated || Date.now(),
				deleted: !!m.deletedAt,
				edited: m.edited !== undefined ? m.edited : 1  // ← 追加
			};
		} );

		metaWasFixed = true;
	}

	// 🧠 正規化（壊れたデータ防止）
	metaCache.memos.forEach( m => {
		if ( typeof m.deleted !== 'boolean' ) {
			m.deleted = false;
			metaWasFixed = true;
		}
		if ( typeof m.title !== 'string' ) {
			m.title = '';
			metaWasFixed = true;
		}
		if ( typeof m.updated !== 'number' ) {
			m.updated = Date.now();
			metaWasFixed = true;
		}
		if ( typeof m.size !== 'number' ) {
			m.size = 0;
			metaWasFixed = true;
		}
		// 🔹 ここに追加
		if ( typeof m.pinned !== 'boolean' ) {
			m.pinned = false;
			metaWasFixed = true;
		}
		if ( !m.pinnedDate ) {
			m.pinnedDate = null;
			metaWasFixed = true;
		}
	} );

	// ✅ 「直した時だけ」保存
	if ( metaWasFixed ) {
		await setDoc( metaRef, metaCache );
	}
	metaCache.totalSize = metaCache.memos.reduce(
		//  (sum, m) => sum + (m.deleted ? 0 : (m.size || 0)),
		( sum, m ) => sum + ( m.size || 0 ),
		0
	);

	renderTotalSize();

	return metaCache;
}

async function loadMemos() {
	await loadMetaOnce();
	memoList.innerHTML = '';

metaCache.memos
  .filter(m => !m.deleted && (m.hasContent ?? true))// ←空のNew Memoは除外
		.sort( ( a, b ) => b.updated - a.updated )
		.forEach( m => {

			const li = document.createElement( 'li' );
			li.style.fontSize = savedSize + 'px'; // ← 一覧に反映
			// 🔹 現在開いているメモに active クラス
			if ( m.id === currentMemoId ) {
				li.classList.add( 'active' );
			}

			/* ========== li 全体を覆う a ========== */
			const link = document.createElement( 'a' );
			link.href = `#/editor/${m.id}`;
			link.style.position = 'absolute';
			link.style.top = '0';
			link.style.left = '0';
			link.style.width = '100%';
			link.style.height = '100%';
			link.style.textDecoration = 'none';
			link.style.color = 'inherit';
			link.style.fontSize = savedSize;
			link.onclick = e => {
				e.preventDefault();
				// location.hash が既に同じIDなら手動で閉じる
				if ( location.hash === `#/editor/${m.id}` ) {
					sidebar.classList.remove( 'show' ); // サイドバーを閉じる

					return; // navigate() は呼ばなくてOK
				}

				location.hash = `#/editor/${m.id}`;
			};
			li.appendChild( link );



			//左側タイトル

			const titleSpan = document.createElement( 'span' );
			titleSpan.className = 'memo-title';
			titleSpan.textContent = m.title || 'New Note';
			// titleSpan.style.fontSize = savedSize;
			li.appendChild( titleSpan );

			// 右側（日付 + メニュー）
			const rightDiv = document.createElement( 'div' );
			rightDiv.className = 'memo-right';
			const sizeSpan = document.createElement( 'span' );
			sizeSpan.className = 'size-span';
			sizeSpan.textContent = formatSize( m.size || 0 );
			if ( isLargeSize( m.size ) ) {
				sizeSpan.classList.add( 'size-warning' );
			}

			const dateSpan = document.createElement( 'span' );
			dateSpan.className = 'date-span';
			// dateSpan.textContent =
			// 	new Date( m.updated ).toLocaleString( 'ja-JP', {
			// 		year: 'numeric', month: '2-digit', day: '2-digit',
			// 		hour: '2-digit', minute: '2-digit'
			// 	} );
			const displayDate = m.pinned ? m.pinnedDate : m.updated;
			dateSpan.textContent = new Date( displayDate ).toLocaleString( 'ja-JP', {
				year: 'numeric', month: '2-digit', day: '2-digit',
				hour: '2-digit', minute: '2-digit'
			} );
			// 🔹 pinned ならマークを追加
			if ( m.pinned ) {
				const pin = document.createElement( 'span' );
				pin.textContent = '🕰️';
				pin.style.marginLeft = '4px';
				dateSpan.appendChild( pin );
			}

			/* ⋯ メニュー */
			const menuBtn = document.createElement( 'button' );
			menuBtn.textContent = '　　⁝';
			menuBtn.className = 'menu-btn';

			const menuPopup = document.createElement( 'div' );
			menuPopup.className = 'menu-popup';
			// 例えば右側の div を親にする場合
			rightDiv.style.position = 'relative'; // 親に relative を付与


			// 📌 ピンボタン
			const pinBtn = document.createElement( 'button' );
			pinBtn.textContent = m.pinned ? '📌' : '📍';
			pinBtn.className = 'menu-btn';
			rightDiv.appendChild( pinBtn );

			// 日付入力欄とOK/キャンセルボタン（初期非表示）
			const pinInput = document.createElement( 'input' );
			pinInput.type = 'text';
			pinInput.style.display = 'none';
			pinInput.style.position = 'absolute';
			pinInput.style.zIndex = '10';
			pinInput.style.width = '200px';
			pinInput.style.padding = '20px 8px';
			pinInput.style.fontSize = '16px';

			const pinOkBtn = document.createElement( 'button' );
			pinOkBtn.textContent = 'OK';
			pinOkBtn.style.display = 'none';
			pinOkBtn.style.position = 'absolute';
			pinOkBtn.style.zIndex = '10';
			pinOkBtn.style.marginLeft = '4px';

			const pinCancelBtn = document.createElement( 'button' );
			pinCancelBtn.textContent = 'キャンセル';
			pinCancelBtn.style.display = 'none';
			pinCancelBtn.style.position = 'absolute';
			pinCancelBtn.style.zIndex = '10';
			pinCancelBtn.style.marginLeft = '4px';

			// 親要素に追加
			rightDiv.appendChild( pinInput );
			rightDiv.appendChild( pinOkBtn );
			rightDiv.appendChild( pinCancelBtn );

			// 初期値設定（既存のコードはそのまま）
			pinInput.value = new Date( displayDate ).toLocaleString( 'ja-JP', {
				year: 'numeric', month: '2-digit', day: '2-digit',
				hour: '2-digit', minute: '2-digit'
			} );
			// ピンボタンクリック
			pinBtn.onclick = ( e ) => {
				e.stopPropagation();
				menuPopup.style.display = 'none';

				const rect = pinBtn.getBoundingClientRect();
				const parentRect = rightDiv.getBoundingClientRect();

				// 親要素相対の座標に変換
				const top = rect.top - parentRect.top;
				const left = rect.left - parentRect.left;

				// pinInput.style.top = top + 'px';
				// pinInput.style.left = left - 120 + 'px';

				pinOkBtn.style.top = top + 200 + 'px';
				pinOkBtn.style.left = left + 60 + 'px';

				pinCancelBtn.style.top = top + 200 + 'px';
				pinCancelBtn.style.left = left +120+ 'px';

				const show = pinInput.style.display === 'none';
				pinInput.style.display = show ? 'inline-block' : 'none';
				pinOkBtn.style.display = show ? 'inline-block' : 'none';
				pinCancelBtn.style.display = show ? 'inline-block' : 'none';

				if ( show ) pinInput.focus();
			};


			// OK / キャンセルのクリック処理は同じ
			pinInput.onclick = pinInput.onfocus = ( e ) => e.stopPropagation();
			pinOkBtn.onclick = async ( e ) => {
				e.stopPropagation();
				const value = pinInput.value.trim();
				const parsed = new Date( value.replace( /-/g, '/' ) );
				const newTime = parsed.getTime();

				if ( isNaN( newTime ) ) {
					alert( '無効な日時です' );
					return;
				}

				m.pinned = true;
				m.pinnedDate = newTime;
				pinBtn.textContent = '📌';

				await saveMeta();
				loadMemos();

				pinInput.style.display = 'none';
				pinOkBtn.style.display = 'none';
				pinCancelBtn.style.display = 'none';
			};

			pinCancelBtn.onclick = ( e ) => {
				e.stopPropagation();
				pinInput.style.display = 'none';
				pinOkBtn.style.display = 'none';
				pinCancelBtn.style.display = 'none';
			};

			const copyBtn = document.createElement( 'button' );
			copyBtn.textContent = '❐';
			copyBtn.onclick = async ( e ) => {
				e.stopPropagation();// li / a のクリックを止める
				const snap = await getDoc(
					doc( db, 'users', auth.currentUser.uid, 'memos', m.id )
				);
				navigator.clipboard.writeText( snap.data()?.content || '' );
				showToast( 'Copied' );
				menuPopup.style.display = 'none';
			};

			const delBtn = document.createElement( 'button' );
			delBtn.textContent = '🗑️';
			delBtn.onclick = async ( e ) => {
				e.stopPropagation();
				m.deleted = true;
				m.updated = Date.now();
				await saveMeta();
				loadMemos();
				showToast( 'Moved to Trash' );
				menuPopup.style.display = 'none';
			};

			menuPopup.append( pinBtn, copyBtn, delBtn );
			menuBtn.onclick = e => {
				e.stopPropagation();
				menuPopup.style.display =
					menuPopup.style.display === 'block' ? 'none' : 'block';
			};

			rightDiv.append( dateSpan, sizeSpan, menuBtn, menuPopup );
			//aタグの中に右側も入れる
			li.appendChild( rightDiv );
			//li に a を追加
			memoList.appendChild( li );
		} );
	renderTotalSize();
}

/* Trash表示 */
function loadTrash() {
	if ( !metaCache || !Array.isArray( metaCache.memos ) ) return;
	trashList.innerHTML = '';

	metaCache.memos
		.filter( m => m.deleted )
		.sort( ( a, b ) => b.updated - a.updated )
		.forEach( m => {
			const li = document.createElement( 'li' );

			/* ========== li 全体を覆う a ========== */
			const link = document.createElement( 'a' );
			link.href = `#/editor/${m.id}`;
			link.style.position = 'absolute';
			link.style.top = '0';
			link.style.left = '0';
			link.style.width = '100%';
			link.style.height = '100%';
			link.style.textDecoration = 'none';
			link.style.color = 'inherit';
			link.onclick = e => {
				e.preventDefault();
				location.hash = `#/editor/${m.id}`;
			};
			li.appendChild( link );

			/* =====================
	 左側タイトル
	 ===================== */

			const titleSpan = document.createElement( 'span' );
			titleSpan.className = 'memo-title';
			titleSpan.textContent = m.title || 'New Note';
			li.appendChild( titleSpan );

			// 右側の操作領域
			/* =====================
							 右側（日付 + メニュー）
							 ===================== */
			const rightDiv = document.createElement( 'div' );
			rightDiv.className = 'memo-right';
			const sizeSpan = document.createElement( 'span' );
			sizeSpan.className = 'size-span';
			sizeSpan.textContent = formatSize( m.size || 0 );

			const dateSpan = document.createElement( 'span' );
			dateSpan.className = 'date-span';
			dateSpan.textContent =
				new Date( m.updated ).toLocaleString( 'ja-JP', {
					year: 'numeric', month: '2-digit', day: '2-digit',
					hour: '2-digit', minute: '2-digit'
				} );

			// 復元ボタン
			const restoreBtn = document.createElement( 'button' );
			restoreBtn.textContent = '↩️';
			restoreBtn.className = 'menu-btn';
			restoreBtn.onclick = async e => {
				e.stopPropagation();
				await updateMeta( m.id, { deleted: false, updated: Date.now() } );
				loadTrash();
				await loadMemos(); // メモ一覧も更新
			};

			// ⋯ メニュー
			const menuBtn = document.createElement( 'button' );
			menuBtn.textContent = '❌';
			menuBtn.className = 'menu-btn';

			const menuPopup = document.createElement( 'div' );
			menuPopup.className = 'menu-popup';

			// 完全削除ボタン
			const delBtn = document.createElement( 'button' );
			delBtn.textContent = 'Delete Permanently';
			delBtn.onclick = async e => {
				e.stopPropagation();
				// Firestoreのドキュメントを削除
				await deleteDoc( doc( db, 'users', auth.currentUser.uid, 'memos', m.id ) );
				// meta からも削除
				metaCache.memos = metaCache.memos.filter( mm => mm.id !== m.id );
				await saveMeta();
				loadTrash();
				showToast( 'Deleted permanently' );
			};

			menuPopup.appendChild( delBtn );
			menuBtn.onclick = e => {
				e.stopPropagation();
				menuPopup.style.display =
					menuPopup.style.display === 'block' ? 'none' : 'block';
			};

			// 右側 div に追加（順序：日付 → 復元 → メニュー）
			rightDiv.append( dateSpan, sizeSpan, restoreBtn, menuBtn, menuPopup );
			li.appendChild( rightDiv );

			trashList.appendChild( li );
		} );
}

async function openEditor( id ) {
	await flushSave();
	currentMemoId = id;

	if ( memoCache[id] ) {
		showEditor( memoCache[id] );
		return;
	}

	const snap = await getDoc( doc( db, 'users', auth.currentUser.uid, 'memos', id ) );
	const data = snap.data();
	memoCache[id] = data;
	showEditor( data );
}

async function showEditor( data = { content: '', title: '' } ) {
	// 既存タイトルを本文の1行目に追加
	const content = data.content || '';
	// 改行を <div> に変換してセット
	editor.innerHTML = content
		.split( '\n' )
		.map( line => line || '<div><br></div>' )  // 空行も br に変換
		.join( '' );
	editor.style.fontSize = savedSize + 'px';

	// カーソルを先頭に移動
	const firstLine = editor.firstChild;
	if ( firstLine ) {
		const range = document.createRange();
		const sel = window.getSelection();
		range.selectNodeContents( firstLine );
		range.collapse( true ); // 先頭にセット
		sel.removeAllRanges();
		sel.addRange( range );
	}
	show( 'editor' );
	window.scrollTo( 0, 0 );
}

// let saveTimer = null;



//7️⃣-2 メモ関連の処理の関数（loadMeta, loadMemos, openEditor, saveMemo, updateMeta など）
async function saveMemo() {
	if ( !currentMemoId ) return;

	const content = editor.innerHTML;
	const size = new Blob( [content] ).size;
	const updated = Date.now();
	const hasContent = content !== '<div><br></div>';

	// タイトルを最初の行にする
	const lines = editor.innerText.split( '\n' );
	let title = '';
	for ( const line of lines ) {
		const trimmed = line.trim();
		if ( trimmed ) {
			title = trimmed;
			break;
		}
	}

	// Firestore 保存
	await setDoc(
		doc( db, 'users', auth.currentUser.uid, 'memos', currentMemoId ),
		{ content, updated },
		{ merge: true }
	);

	// meta 更新（タイトル・size・edited）
	await updateMeta( currentMemoId, { updated, edited: 1, size, title, hasContent } );

	// memoCache も同期
	memoCache[currentMemoId] = {
		...( memoCache[currentMemoId] || {} ),
		content,
		updated,
		title,
	};

	// total size 更新
	metaCache.totalSize = metaCache.memos.reduce(
		( sum, m ) => sum + ( m.deleted ? 0 : ( m.size || 0 ) ),
		0
	);

	renderTotalSize();
}

async function saveMeta() {
	await setDoc(
		doc( db, 'users', auth.currentUser.uid, 'meta', 'main' ),
		metaCache
	);
}

function getMeta( id ) {
	return metaCache.memos.find( m => m.id === id );
}

async function updateMeta( id, fields ) {
	const m = getMeta( id );
	if ( !m ) return;
	Object.assign( m, fields );
	await saveMeta();
}
async function fixSizesOnce() {
	let fixed = false;
	const memosToCheck = metaCache.memos.filter( m => !m.size || m.size <= 0 );
	if ( memosToCheck.length === 0 ) return;

	// Firestore getDocs でまとめて取得
	const memoRefs = memosToCheck.map( m => doc( db, 'users', auth.currentUser.uid, 'memos', m.id ) );
	const snaps = await Promise.all( memoRefs.map( ref => getDoc( ref ) ) );

	snaps.forEach( ( snap, i ) => {
		if ( !snap.exists() ) return;
		const content = snap.data().content || '';
		memosToCheck[i].size = new Blob( [content] ).size;
		fixed = true;
	} );

	if ( fixed ) {
		metaCache.totalSize = metaCache.memos.reduce(
			( sum, m ) => sum + ( m.deleted ? 0 : ( m.size || 0 ) ),
			0
		);
		await saveMeta();
		renderTotalSize();
	}
}

function formatSize( bytes = 0 ) {
	const kb = Math.max( 0, Math.floor( bytes / 1024 ) );

	if ( kb >= 1024 ) {
		return ( kb / 1024 ).toFixed( 2 ) + ' MB';
	}
	return kb + ' KB';
}
function isLargeSize( bytes = 0 ) {
	return bytes >= 700 * 1024;
}
//8️⃣ エディターイベント（入力、貼り付け、キーボード操作）
//タイトル取得
function extractTitle( editor ) {
	const text = editor.innerText || '';

	const lines = text
		.split( '\n' )
		.map( l => l.trim() )
		.filter( l => l.length > 0 );

	return lines[0] || '';
}

let titleTimer = null;

function updateTitleDebounced( id, title ) {
	clearTimeout( titleTimer );
	titleTimer = setTimeout( () => {
		updateMeta( id, { title, updated: Date.now() } );
	}, 500 );
}
editor.addEventListener('input', () => {
    if (isNewMemo) {
        tryCreateMemoOnce();
    }
    debounceSave();
});
let creatingMemo = false;

async function tryCreateMemoOnce() {
    if (!isNewMemo) return;
    if (currentMemoId) return;
    if (creatingMemo) return;

    const content = editor.innerHTML;
    if (content === '<div><br></div>' || !editor.innerText.trim()) return;

    creatingMemo = true;

    const ref = await addDoc(
        collection(db, 'users', auth.currentUser.uid, 'memos'),
        {
            content,
            updated: Date.now(),
            edited: 0,
            size: new Blob([content]).size,
        }
    );

    currentMemoId = ref.id;
    isNewMemo = false;
    tempNewMemo = null;

    metaCache.memos.push({
        id: ref.id,
        title: '',
        updated: Date.now(),
        deleted: false,
        edited: 0,
        size: new Blob([content]).size,
        hasContent: true
    });

    await saveMeta();
}
// ===== Italic → h2 変換 =====
editor.addEventListener( 'beforeinput', e => {
	if ( e.inputType === 'formatItalic' ) {
		e.preventDefault();

		// 選択範囲 or カーソル位置を h2 に
		document.execCommand( 'formatBlock', false, 'h2' );

		// 念のため i / em が残ってたら剥がす
		editor.querySelectorAll( 'i, em' ).forEach( el => {
			el.replaceWith( ...el.childNodes );
		} );

		// 保存トリガー
		editor.dispatchEvent( new Event( 'input', { bubbles: true } ) );
	}
} );

editor.addEventListener( 'beforeinput', e => {
	if ( e.inputType === 'formatUnderline' ) {
		e.preventDefault(); // デフォルトの下線を止める

		// 選択範囲に <s> を適用
		document.execCommand( 'strikeThrough' );

		// 念のため i / em / u が残ってたら剥がす
		editor.querySelectorAll( 'i, em, u' ).forEach( el => {
			el.replaceWith( ...el.childNodes );
		} );

		// 保存トリガー
		editor.dispatchEvent( new Event( 'input', { bubbles: true } ) );
	}
} );

editor.addEventListener( 'keydown', e => {
	const sel = document.getSelection();
	if ( !sel.rangeCount ) return;

	// カーソル直前のテキストを取得
	const range = sel.getRangeAt( 0 );
	const node = range.startContainer;
	const offset = range.startOffset;

	if ( node.nodeType === 3 ) { // テキストノード
		const text = node.textContent;
		// ^_^ が直前にあるか？
		if ( text.slice( offset - 3, offset ) === '^_^' ) {
			e.preventDefault();

			// ^_^ を削除
			node.deleteData( offset - 3, 3 );

			// 選択範囲を h2 に
			document.execCommand( 'formatBlock', false, 'h2' );

			// 念のため i/em を剥がす
			editor.querySelectorAll( 'i, em' ).forEach( el => el.replaceWith( ...el.childNodes ) );

			// 保存トリガー
			editor.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		}
	}
} );
editor.addEventListener( 'keydown', e => {
	// Windows: Ctrl+I / Mac: Cmd+I
	if ( ( e.ctrlKey || e.metaKey ) && e.key.toLowerCase() === 'i' ) {
		e.preventDefault(); // ブラウザのデフォルト動作を止める
		document.execCommand( 'italic' ); // 選択中をイタリックに
	}
} );

/* Paste処理（画像・埋め込み・テキスト対応 完全版） */
editor.addEventListener( 'paste', async e => {
	e.preventDefault();
	const range = document.getSelection().getRangeAt( 0 );
	const text = e.clipboardData.getData( 'text/plain' ).trim();
	const items = e.clipboardData.items || [];
	const files = e.clipboardData.files || [];

	// 埋め込み専用挿入関数
	const insertNodeWithCursor = ( node, originalUrl = null, isEmbed = false ) => {
		if ( originalUrl ) node.dataset.url = originalUrl; // Deleteで戻す用
		range.insertNode( node );

		if ( isEmbed ) {
			const br = document.createElement( 'br' );
			range.setStartAfter( node );
			range.insertNode( br );
			range.setStartAfter( br );
		} else {
			range.setStartAfter( node );
		}

		range.collapse( true );
		editor.dispatchEvent( new Event( 'input', { bubbles: true } ) );
	};

	const insertImageFromBase64 = ( base64, isEmbed = false ) => {
		const [meta, content] = base64.split( ',' );
		const mime = meta.match( /:(.*?);/ )[1];
		const binary = atob( content );
		const array = new Uint8Array( binary.length );
		for ( let i = 0; i < binary.length; i++ ) array[i] = binary.charCodeAt( i );

		const img = document.createElement( 'img' );
		img.src = base64;
		// base64直埋めなので dataset.url は不要
		if ( isEmbed ) img.dataset.embed = '1';

		img.onerror = () => {
			const iframe = document.createElement( 'iframe' );
			iframe.width = img.width;
			iframe.height = img.height;
			iframe.src = 'about:blank';
			iframe.style.border = '1px solid #ccc';
			img.replaceWith( iframe );
		};
		insertNodeWithCursor( img, null, isEmbed );
	};

	for ( const item of items ) {
		if ( item.type.startsWith( 'image/' ) ) {
			e.preventDefault();
			const file = item.getAsFile();
			const originalSizeBytes = file.size;  // これが貼り付け時点の容量
			const originalSizeMB = ( originalSizeBytes / ( 1024 * 1024 ) ).toFixed( 2 );
			const img = new Image();
			const blobUrl = URL.createObjectURL( file );
			img.src = blobUrl;
			await img.decode();

			// ========================
			// 最大幅1024px固定でリサイズ
			const MAX_WIDTH = 1024;
			let w = img.width;
			let h = img.height;
			if ( w > MAX_WIDTH ) {
				h = Math.round( h * ( MAX_WIDTH / w ) );
				w = MAX_WIDTH;
			}

			const canvas = document.createElement( 'canvas' );
			const ctx = canvas.getContext( '2d' );
			canvas.width = w;
			canvas.height = h;
			ctx.drawImage( img, 0, 0, w, h );

			// ========================
			// JPEG圧縮 + 1MB保証 + ループ回数
			const MAX_BYTES = 100000;
			const BASE64_EXPAND = 1.37;
			const MAX_BLOB_BYTES = MAX_BYTES / BASE64_EXPAND;

			let quality = 0.8;
			let scale = 1.0;
			let loopCount = 0;

			// 元のキャンバスサイズを保持
			const originalWidth = canvas.width;
			const originalHeight = canvas.height;

			let safeBlob = await new Promise( resolve => canvas.toBlob( resolve, 'image/jpeg', quality ) );

			while ( safeBlob.size > MAX_BLOB_BYTES && ( quality > 0.1 || scale > 0.1 ) ) {
				loopCount++;

				if ( quality > 0.1 ) {
					quality -= 0.05;
					// 元のキャンバスで再圧縮
					safeBlob = await new Promise( resolve => canvas.toBlob( resolve, 'image/jpeg', quality ) );
				} else {
					// scaleを下げて新しい一時キャンバスを作る
					scale *= 0.9;
					const tmpCanvas = document.createElement( 'canvas' );
					tmpCanvas.width = Math.floor( originalWidth * scale );
					tmpCanvas.height = Math.floor( originalHeight * scale );
					const ctx = tmpCanvas.getContext( '2d' );
					ctx.drawImage( canvas, 0, 0, tmpCanvas.width, tmpCanvas.height );

					// tmpCanvas で再圧縮
					safeBlob = await new Promise( resolve => tmpCanvas.toBlob( resolve, 'image/jpeg', quality ) );
				}
			}

			// ========================
			// Firestore保存 + showToastで容量とループ回数表示
			const reader = new FileReader();
			reader.onloadend = async () => {
				const base64 = reader.result;
				const now = new Date();
				const pad = n => n.toString().padStart( 2, '0' );
				const filename = `pasted_${now.getFullYear()}-${pad( now.getMonth() + 1 )}-${pad( now.getDate() )}_${pad( now.getHours() )}-${pad( now.getMinutes() )}-${pad( now.getSeconds() )}`;
				// サイズ表示用関数
				function formatSize( bytes ) {
					if ( bytes >= 1024 * 1024 ) {
						return ( bytes / ( 1024 * 1024 ) ).toFixed( 1 ) + ' MB'; // 1MB以上 → MB、小数1桁
					} else {
						return Math.round( bytes / 1024 ) + ' KB';           // 1MB未満 → KB、整数
					}
				}
				const sizeBytes = base64.length;
				// サイズを文字列に変換
				const savedSizeStr = formatSize( sizeBytes );
				const originalSizeStr = formatSize( originalSizeBytes );

				// alert 表示
				// alert( `${now}: Saved: ${savedSizeStr} (Original: ${originalSizeStr}) | JPEG loops: ${loopCount}` );
				showToast( `Saved: ${savedSizeStr} (Original: ${originalSizeStr}) | JPEG loops: ${loopCount}` );


				// insertImageFromBase64( base64, filename, true );
				insertImageFromBase64( base64, true );
			};
			reader.readAsDataURL( safeBlob );

			return; // 1枚だけ処理
		}
	}

	// YouTube
	const yt = text.match( /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]+)/ );
	if ( yt ) {
		const wrap = document.createElement( 'div' );
		wrap.className = 'video';
		const iframe = document.createElement( 'iframe' );
		iframe.src = `https://www.youtube-nocookie.com/embed/${yt[1]}?modestbranding=1&rel=0&playsinline=1`;
		iframe.allowFullscreen = true;
		wrap.appendChild( iframe );
		insertNodeWithCursor( wrap, text, true );
		return;
	}

	// ニコニコ動画
	const nico = text.match( /nicovideo\.jp\/watch\/([\w]+)/ );
	if ( nico ) {
		const wrap = document.createElement( 'div' );
		wrap.className = 'video';
		const iframe = document.createElement( 'iframe' );
		iframe.src = `https://embed.nicovideo.jp/watch/${nico[1]}`;
		iframe.setAttribute( 'frameborder', '0' );
		iframe.setAttribute( 'allowfullscreen', '' );
		wrap.appendChild( iframe );
		insertNodeWithCursor( wrap, text, true );
		return;
	}

	// TikTok
	const tiktok = text.match( /tiktok\.com\/.*\/video\/(\d+)/ );
	if ( tiktok ) {
		const wrap = document.createElement( 'div' );
		wrap.className = 'tiktok';
		const iframe = document.createElement( 'iframe' );
		iframe.src = `https://www.tiktok.com/embed/${tiktok[1]}`;
		iframe.allow = 'autoplay; fullscreen';
		iframe.allowFullscreen = true;
		wrap.appendChild( iframe );
		insertNodeWithCursor( wrap, text, true );
		return;
	}

	// Twitter / X
	const tw = text.match( /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/[\w@]+\/status\/(\d+)/i );
	if ( tw ) {
		const wrap = document.createElement( 'div' );
		wrap.className = 'twitter';
		const blockquote = document.createElement( 'blockquote' );
		blockquote.className = 'twitter-tweet';
		const a = document.createElement( 'a' );
		a.href = text.replace( /^https?:\/\/(www\.)?x\.com\//i, 'https://twitter.com/' );
		blockquote.appendChild( a );
		wrap.appendChild( blockquote );
		insertNodeWithCursor( wrap, text, true );
		if ( window.twttr?.widgets ) window.twttr.widgets.load( wrap );
		return;
	}

	// Instagram
	const insta = text.match( /https?:\/\/(www\.)?instagram\.com\/p\/([\w-]+)/i );
	if ( insta ) {
		const postUrl = `https://www.instagram.com/p/${insta[2]}/`;
		const wrap = document.createElement( 'div' );
		wrap.className = 'instagram';
		const blockquote = document.createElement( 'blockquote' );
		blockquote.className = 'instagram-media';
		blockquote.setAttribute( 'data-instgrm-permalink', postUrl );
		blockquote.setAttribute( 'data-instgrm-version', '14' );
		wrap.appendChild( blockquote );
		insertNodeWithCursor( wrap, text, true );
		if ( window.instgrm?.Embeds?.process ) window.instgrm.Embeds.process( wrap );
		return;
	}

	// URL付き画像も含むリンク
	const imgRegex = /https?:\/\/\S+\.(?:png|jpg|jpeg|gif)/i;
	if ( imgRegex.test( text ) ) {
		const aEl = document.createElement( 'a' );
		aEl.href = text;
		aEl.dataset.url = text;
		aEl.target = '_blank';
		const imgEl = document.createElement( 'img' );
		imgEl.src = text;
		aEl.appendChild( imgEl );
		insertNodeWithCursor( aEl, text, true );
		return;
	}

	// 通常リンク
	const urlRegex = /(https?:\/\/[^\s]+)/i;
	const urlMatch = text.match( urlRegex );
	if ( urlMatch ) {
		const aEl = document.createElement( 'a' );
		aEl.href = urlMatch[0];        // マッチしたURLをhrefに
		aEl.textContent = urlMatch[0]; // そのままテキストとして表示
		aEl.target = '_blank';
		aEl.dataset.url = urlMatch[0]; // Deleteで戻す用
		insertNodeWithCursor( aEl, urlMatch[0], false );
		return;
	}

	// 通常テキスト
	insertNodeWithCursor( document.createTextNode( text ), null, false );
} );
editor.addEventListener( 'click', e => {
	const a = e.target.closest( 'a' );
	if ( !a ) return;

	// 編集中だけJS制御
	if ( editor.contentEditable === 'true' ) {
		e.preventDefault();
		return;
	}

	// 閲覧中は何もしない（Safariに任せる）
} );


let touchStartTime = 0;
let touchMoved = false;
let longPress = false;
let lastTouch = null;


editor.addEventListener( 'touchstart', e => {
	lastTouch = e.touches[0];   // ← ★この1行を追加
	touchStartTime = Date.now();
	touchMoved = false;
	longPress = false;

	// リンク・画像・埋め込み上は長押し候補
	if (
		e.target.closest( 'a' ) ||
		e.target.closest( 'img' ) ||
		e.target.closest( 'iframe' ) ||
		e.target.closest( '.video' ) ||
		e.target.closest( '.twitter' ) ||
		e.target.closest( '.instagram' )
	) {
		longPress = true;
	}
} );

editor.addEventListener( 'touchmove', () => {
	touchMoved = true;
} );

editor.addEventListener( 'touchend', () => {
	// 🔒 リンクプレビュー後は何もしない
	if ( longPress ) return;

	const dt = Date.now() - touchStartTime;

	// 短タップだけ編集開始
	if (
		dt < 300 &&
		!touchMoved &&
		editor.contentEditable === 'false'
	) {
		editor.contentEditable = 'true';
		// editor.focus();
		const x = lastTouch.clientX;
		const y = lastTouch.clientY;

		const range = document.caretRangeFromPoint( x, y );
		if ( range ) {
			const sel = window.getSelection();
			sel.removeAllRanges();
			sel.addRange( range );
		}

		editor.focus( { preventScroll: true } );
	}
} );



editor.addEventListener( 'keydown', ( e ) => {
	// Undo (Cmd/Ctrl + Z)
	if ( ( e.metaKey || e.ctrlKey ) && !e.shiftKey && e.key.toLowerCase() === 'z' ) {
		e.preventDefault();
		// @ts-ignore
		document.execCommand( 'undo' );
		return;
	}

	// Redo (Cmd/Ctrl + Shift + Z)
	if ( ( e.metaKey || e.ctrlKey ) && e.shiftKey && e.key.toLowerCase() === 'z' ) {
		e.preventDefault();
		// @ts-ignore
		document.execCommand( 'redo' );
		return;
	}
} );

// Delete/Backspaceで元URLに戻す
editor.addEventListener( 'keydown', e => {
	if ( e.key !== 'Delete' && e.key !== 'Backspace' ) return;

	const sel = document.getSelection();
	if ( !sel.rangeCount ) return;
	const range = sel.getRangeAt( 0 );
	// 範囲選択なら完全にデフォルトに任せる
	if ( !range.collapsed ) return;

	// テキストノードなら親をチェック
	let node = range.startContainer;
	if ( node.nodeType === 3 ) node = node.parentNode;

	// imgや埋め込みdivを上にたどる
	while ( node && !node.dataset?.url ) node = node.parentNode;
	if ( !node?.dataset?.url ) return;

	e.preventDefault();
	// 元URLに置き換え
	const urlText = document.createTextNode( node.dataset.url );
	node.replaceWith( urlText );
	const newRange = document.createRange();
	newRange.selectNodeContents( urlText );

	sel.removeAllRanges();
	sel.addRange( newRange );

	// focus を明示的にセット（iOS 対応）
	editor.focus();

	// 改行追加（range 選択後に置く）
	// const br = document.createElement( 'br' );
	// urlText.after( br );

	editor.dispatchEvent( new Event( 'input', { bubbles: true } ) );
} );

/* 9️⃣ ナビゲーション・新規作成ボタン*/
document.getElementById( 'go-trash' ).onclick = e => {
	e.preventDefault();
	window.open( 'https://migawariw.github.io/DreadNote6/DreadNote/icon1/index.html#/trash', '_blank' );
};
document.getElementById( 'back-list' ).onclick = () => { location.hash = '#/list'; }
document.getElementById( 'back' ).onclick = () => { if ( history.length > 1 ) history.back(); else location.hash = '#/list'; }
/* New memo button */
document.getElementById( 'new-memo' ).onclick = async () => {
	await loadMetaOnce(); // ← 必ず先に呼ぶ
	// // 本文ドキュメントを1件だけ作る
	// const ref = await addDoc(
	// 	collection( db, 'users', auth.currentUser.uid, 'memos' ),
	// 	{ title: '', content: '', updated: Date.now() }
	// );

	// // meta（目次箱）に追加
	// metaCache.memos.push( {
	// 	id: ref.id,
	// 	title: '',
	// 	updated: Date.now(),
	// 	deleted: false,
	// 	size: 0
	// } );

	// // meta保存
	// await setDoc(
	// 	doc( db, 'users', auth.currentUser.uid, 'meta', 'main' ),
	// 	metaCache
	// );
	// // 🔒 サイドバーを閉じる
	// sidebar.classList.remove( 'show' );

	// // エディタへ
	// location.hash = `#/editor/${ref.id}`;
	sidebar.classList.remove( 'show' );
	location.hash = '#/editor/new';
};
document.getElementById( 'new-memo-2' ).onclick =
	document.getElementById( 'new-memo' ).onclick;
window.addEventListener( 'hashchange', async () => { await flushSave(); } );
window.addEventListener( 'beforeunload', async ( e ) => { await flushSave(); } );
/* navigate() を hash に依存しない、安全版に変更 */
async function navigate() {
	if ( !auth.currentUser ) return show( 'login' );

	await loadMetaOnce(); // ← 必ず metaCache をロード

	const hash = location.hash;

	if ( hash.startsWith( '#/editor/' ) ) {
		const id = hash.split( '/' )[2];
		if ( !id ) return;
		if ( id === 'new' ) {
			await openNewMemo(); // 新規メモを作成
			return;
		}


		const meta = getMeta( id );
		if ( !meta ) {
			// Firestoreにまだ存在するか確認
			const snap = await getDoc( doc( db, 'users', auth.currentUser.uid, 'memos', id ) );
			if ( !snap.exists() ) {
				showToast( 'メモが存在しません' );
				sidebar.classList.add( 'show' ); // 一覧表示
				return;
			}
			// metaCache に追加
			const data = snap.data();
			metaCache.memos.push( {
				id,
				title: data.title || '',
				updated: data.updated || Date.now(),
				deleted: !!data.deleted,
				edited: data.edited !== undefined ? data.edited : 1,
				size: data.content ? data.content.length : 0
			} );
			await saveMeta();
		}

		await openEditor( id );
		// 🔒 サイドバーを閉じる
		sidebar.classList.remove( 'show' );
	}
}