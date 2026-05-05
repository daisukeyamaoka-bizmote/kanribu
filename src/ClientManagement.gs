/**
 * クライアント管理 (ステップ4 D-2)
 *
 * - syncAllFromFreee: 既存6社の freee 取引先情報(登録名・住所)を同期
 * - addClientFromFreee: freee取引先IDから新規クライアント行を作成
 *
 * クライアントの停止・To担当者変更などは 01_クライアントマスタ を直接編集する。
 */
const ClientManagement = {
  CLIENT_SHEET: '01_クライアントマスタ',

  /**
   * 全クライアントの freee 取引先情報を同期
   * - freee登録名 を上書き
   * - 住所(郵便番号)、住所 を上書き
   * 同期対象は freee取引先ID が設定されているクライアントのみ
   */
  syncAllFromFreee: function() {
    const clients = SheetUtil.readAsObjects(this.CLIENT_SHEET, 1, 3);

    const updated = [];
    const noChange = [];
    const errors = [];

    clients.forEach(c => {
      const partnerId = c['freee取引先ID'];
      if (!partnerId) {
        errors.push({ clientId: c['クライアントID'], error: 'freee取引先IDが空' });
        return;
      }

      try {
        const partner = FreeeClient.getPartner(partnerId);
        if (!partner) throw new Error('freee取引先が見つかりません');

        const addr = partner.address_attributes || {};
        const zip = String(addr.zipcode || '').trim();
        const fullAddr = [addr.street_name1, addr.street_name2]
          .filter(s => s)
          .map(s => String(s).trim())
          .join(' ');

        const updates = {};
        if (partner.name && String(partner.name).trim() !== String(c['freee登録名'] || '').trim()) {
          updates['freee登録名'] = partner.name;
        }
        if (zip && zip !== String(c['住所(郵便番号)'] || '').trim()) {
          updates['住所(郵便番号)'] = zip;
        }
        if (fullAddr && fullAddr !== String(c['住所'] || '').trim()) {
          updates['住所'] = fullAddr;
        }

        if (Object.keys(updates).length > 0) {
          SheetUtil.updateRow(this.CLIENT_SHEET, c._rowNumber, updates);
          updated.push({
            clientId: c['クライアントID'],
            clientName: c['企業名'],
            updatedFields: Object.keys(updates),
          });
        } else {
          noChange.push({
            clientId: c['クライアントID'],
            clientName: c['企業名'],
          });
        }

        Utilities.sleep(300); // freee API rate limit
      } catch (e) {
        Logger.log(`freee同期失敗 ${c['クライアントID']}: ${e.message}`);
        errors.push({ clientId: c['クライアントID'], error: e.message });
      }
    });

    return {
      total: clients.length,
      updated: updated,
      noChange: noChange,
      errors: errors,
    };
  },

  /**
   * freee取引先IDから新規クライアント行を作成
   * 必須項目だけ自動で埋め、残りは手動編集を促す
   */
  addClientFromFreee: function(partnerId, clientId) {
    if (!partnerId) throw new Error('freee取引先IDを指定してください');
    if (!clientId) throw new Error('クライアントID(例: clt-newco)を指定してください');

    const clients = SheetUtil.readAsObjects(this.CLIENT_SHEET, 1, 3);
    if (clients.find(c => String(c['クライアントID']).trim() === clientId)) {
      throw new Error(`クライアントID "${clientId}" は既に存在します`);
    }
    if (clients.find(c => Number(c['freee取引先ID']) === Number(partnerId))) {
      throw new Error(`freee取引先ID ${partnerId} は既に登録されています`);
    }

    const partner = FreeeClient.getPartner(partnerId);
    if (!partner) throw new Error(`freee取引先が見つかりません: ${partnerId}`);

    const addr = partner.address_attributes || {};
    const fullAddr = [addr.street_name1, addr.street_name2]
      .filter(s => s)
      .map(s => String(s).trim())
      .join(' ');

    SheetUtil.appendRow(this.CLIENT_SHEET, {
      'クライアントID': clientId,
      '企業名': partner.name || '',
      'freee取引先ID': Number(partnerId),
      'freee登録名': partner.name || '',
      'ステータス': '稼働中',
      '送付方法': 'メール',
      '住所(郵便番号)': String(addr.zipcode || '').trim(),
      '住所': fullAddr,
      '件名テンプレ': '{年}/{月} ',
      '支払サイト': '月末締翌月末払',
    });

    return {
      clientId: clientId,
      partnerName: partner.name,
      partnerId: partnerId,
    };
  },
};

/**
 * メニューから呼ばれる: 全クライアントを freee と同期
 */
function syncClientsFromFreee() {
  const ui = SpreadsheetApp.getUi();
  try {
    const result = ClientManagement.syncAllFromFreee();

    let msg = `クライアント数: ${result.total}社\n` +
              `更新あり: ${result.updated.length}件\n` +
              `変更なし: ${result.noChange.length}件\n` +
              `エラー: ${result.errors.length}件`;

    if (result.updated.length > 0) {
      msg += '\n\n[更新内容]\n' + result.updated.map(u =>
        `- ${u.clientName} (${u.clientId}): ${u.updatedFields.join(', ')}`
      ).join('\n');
    }
    if (result.errors.length > 0) {
      msg += '\n\n[エラー]\n' + result.errors.map(e =>
        `- ${e.clientId}: ${e.error}`
      ).join('\n');
    }

    ui.alert('クライアント freee 同期 完了', msg, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('クライアント freee 同期 エラー', e.message, ui.ButtonSet.OK);
  }
}

/**
 * メニューから呼ばれる: freee取引先IDから新規クライアント追加
 */
function addClientFromFreeeMenu() {
  const ui = SpreadsheetApp.getUi();

  const partnerIdResp = ui.prompt(
    '新規クライアント追加 (1/2)',
    'freee取引先ID(数値)を入力してください\n例: 73961942\n\n' +
    '※先に freee 管理画面で取引先を作成しておいてください',
    ui.ButtonSet.OK_CANCEL
  );
  if (partnerIdResp.getSelectedButton() !== ui.Button.OK) return;
  const partnerId = String(partnerIdResp.getResponseText()).trim();
  if (!partnerId) return;

  const clientIdResp = ui.prompt(
    '新規クライアント追加 (2/2)',
    'クライアントID(社内ID)を入力してください\n例: clt-newco\n\n' +
    'プレフィックス clt- 推奨。半角英数字とハイフンで構成',
    ui.ButtonSet.OK_CANCEL
  );
  if (clientIdResp.getSelectedButton() !== ui.Button.OK) return;
  const clientId = String(clientIdResp.getResponseText()).trim();
  if (!clientId) return;

  try {
    const result = ClientManagement.addClientFromFreee(partnerId, clientId);
    ui.alert(
      'クライアント追加 完了',
      `${result.partnerName} を ${result.clientId} として追加しました。\n\n` +
      '01_クライアントマスタ シートで残りの列を埋めてください:\n' +
      '・事業分野(営業支援/トスアップ支援 など)\n' +
      '・案件オーナー(山岡/須藤/横山 など)\n' +
      '・To担当者名 / Toアドレス\n' +
      '・CCアドレス / 社内CC(任意)\n' +
      '・件名テンプレ(例: {年}/{月} 〇〇支援)\n' +
      '・支払サイト',
      ui.ButtonSet.OK
    );
  } catch (e) {
    ui.alert('クライアント追加 エラー', e.message, ui.ButtonSet.OK);
  }
}
