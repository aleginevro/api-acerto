const express = require('express');
const cors = require('cors');
const { sql, getPool } = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('API Node.js para SQL Server está rodando!');
});

app.post('/api/sp-consulta-ipe-via-rev', async (req, res) => {
  try {
    const { REV_COD } = req.body;

    if (REV_COD === undefined || REV_COD === null) { 
      return res.status(400).json({
        success: false,
        error: 'Parâmetro REV_COD é obrigatório.'
      });
    }

    const pool = await getPool();
    if (!pool) {
      return res.status(500).json({
        success: false,
        error: 'Não foi possível conectar ao banco de dados.'
      });
    }

    console.log(`📊 [sp-ConsultaIpeViaRev] Executando SP para REV_COD: ${REV_COD}`);

    const request = pool.request();
    request.input('REV_COD', sql.Int, parseInt(REV_COD.toString() || '0')); 

    const result = await request.execute('sp_ConsultaIpeViaRev');

    console.log(`✅ [sp-ConsultaIpeViaRev] SP executada com sucesso. Registros: ${result.recordset.length}`);

    res.json({
      success: true,
      data: result.recordset
    });

  } catch (error) {
    console.error('❌ [sp-ConsultaIpeViaRev] Erro na SP:', error.message);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor ao executar Stored Procedure. Detalhes: ' + error.message
    });
  }
});

app.post('/api/atualizar-status-itens-ipe', async (req, res) => {
  try {
    const { itens } = req.body;

    if (!Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'É necessário enviar um array de itens para sincronizar.'
      });
    }

    const pool = await getPool();
    if (!pool) {
      return res.status(500).json({
        success: false,
        error: 'Não foi possível conectar ao banco de dados.'
      });
    }

    console.log(`🔄 [atualizar-status-itens-ipe] Iniciando sincronização de ${itens.length} itens`);

    let sincronizados = 0;
    const erros = [];

    // Processar cada item individualmente
    for (const item of itens) {
      try {
        // Validação: IPE_COD é obrigatório para identificação
        if (!item.IPE_COD) { 
          erros.push({ item, erro: 'IPE_COD ausente para este item. Não é possível sincronizar.' });
          continue;
        }

        const request = pool.request();
        
        // Define o status a ser atualizado (8 para devolvido)
        request.input('IPE_STA', sql.Int, 8); 
        // Usa o IPE_COD como identificador único
        request.input('IPE_COD', sql.Int, parseInt(item.IPE_COD)); 

        // Query de atualização simplificada usando IPE_COD e o nome correto da tabela
        const query = 'UPDATE CAD_IPE SET IPE_STA = @IPE_STA WHERE IPE_COD = @IPE_COD'; // <--- CORRIGIDO AQUI!
        
        console.log(`  📝 Query: ${query}`);
        console.log(`  📦 Item: IPE_COD=${item.IPE_COD}`);

        const result = await request.query(query);
        
        if (result.rowsAffected[0] > 0) {
          sincronizados++;
          console.log(`  ✅ Item IPE_COD=${item.IPE_COD} atualizado com sucesso (${result.rowsAffected[0]} registro(s))`);
        } else {
          erros.push({ item, erro: `Nenhum registro atualizado para IPE_COD=${item.IPE_COD} (item não encontrado ou já com status 8)` });
          console.log(`  ⚠️ Nenhum registro atualizado para IPE_COD=${item.IPE_COD}`);
        }

      } catch (itemError) {
        console.error(`  ❌ Erro ao processar item IPE_COD=${item.IPE_COD}:`, itemError.message);
        erros.push({ item, erro: itemError.message });
      }
    }

    console.log(`✅ [atualizar-status-itens-ipe] Sincronização concluída: ${sincronizados}/${itens.length} itens`);

    res.json({
      success: true,
      sincronizados,
      total: itens.length,
      erros: erros.length > 0 ? erros : undefined,
      message: `${sincronizados} de ${itens.length} itens sincronizados com sucesso`
    });

  } catch (error) {
    console.error('❌ [atualizar-status-itens-ipe] Erro geral:', error.message);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor ao atualizar itens. Detalhes: ' + error.message
    });
  }
});


app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});