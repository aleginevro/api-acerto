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

// Endpoint para consultar itens do pedido via REV_COD ou PED_COD
// NOTA: Este endpoint não precisa de alterações, pois a SP retorna os novos campos automaticamente
app.post('/api/sp-consulta-ipe-via-rev', async (req, res) => {
  try {
    const { REV_COD, PED_COD } = req.body;

    if ((REV_COD === undefined || REV_COD === null) && (PED_COD === undefined || PED_COD === null)) {
      return res.status(400).json({
        success: false,
        error: 'Pelo menos um dos parâmetros (REV_COD ou PED_COD) é obrigatório.'
      });
    }

    const pool = await getPool();
    if (!pool) {
      return res.status(500).json({
        success: false,
        error: 'Não foi possível conectar ao banco de dados.'
      });
    }

    const request = pool.request();

    if (PED_COD !== undefined && PED_COD !== null) {
      request.input('PED_COD', sql.Int, parseInt(PED_COD.toString() || '0'));
      console.log(`📊 [sp-ConsultaIpeViaRev] Executando SP para PED_COD: ${PED_COD}`);
    } else {
      request.input('REV_COD', sql.Int, parseInt(REV_COD.toString() || '0'));
      console.log(`📊 [sp-ConsultaIpeViaRev] Executando SP para REV_COD: ${REV_COD}`);
    }

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

// Endpoint para atualizar status de itens IPE ou inserir/deletar
// ATUALIZADO: INSERT sem CUP_TAM (campo não existe na CAD_IPE)
app.post('/api/atualizar-status-itens-ipe', async (req, res) => {
  try {
    const { itens } = req.body;

    // Log que mostra os itens INTEIROS que o server.js RECEBEU do Base44
    console.log('--- SERVER.JS RECEBEU ESTES ITENS DO BASE44 ---');
    console.log(JSON.stringify(itens, null, 2));
    console.log('--- FIM DO RECEBIMENTO ---');


    if (!Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'É necessário enviar um array de itens para sincronizar.'
      });
    }

    const pool = await getPool();
    // ... código existente ...

    for (let i = 0; i < itens.length; i++) {
      const item = itens[i];
      
      // Log detalhado de CADA ITEM dentro do loop
      console.log(`--- Processando item ${i} ---`);
      console.log(`Item.IPE_COD: ${item.IPE_COD}`);
      console.log(`Item.IPE_STA: ${item.IPE_STA}`);
      console.log(`Item.FORA_DO_PEDIDO: ${item.FORA_DO_PEDIDO}`);
      console.log(`Item.CUP_CDI: ${item.CUP_CDI}`);
      console.log(`Item.CUP_REF: ${item.CUP_REF}`);
      console.log(`Item.IPE_DFP: ${item.IPE_DFP}`);
      console.log(`Item.IPE_DDV: ${item.IPE_DDV}`);
      console.log(`Item.USU_DEV: ${item.USU_DEV}`);
      console.log(`Item.CUP_COD: ${item.CUP_COD}`);
      console.log(`Item.UNI_COD: ${item.UNI_COD}`);
      console.log(`Item.REMARCADO_PROX_MES: ${item.REMARCADO_PROX_MES}`);
      console.log(`--- Fim do item ${i} ---`);


      try {
        const request = pool.request();

        // ... seu código para DELETE (item.FORA_DO_PEDIDO && item.IPE_STA === 1) ...

        // --- ESTE É O BLOCO DE INSERT QUE NOS INTERESSA PARA ITENS FORA DO PEDIDO ---
        if (item.FORA_DO_PEDIDO && item.IPE_STA === 9) { // Apenas INSERIR se for fora do pedido E status 9
          console.log(`  ➕ INSERT: Item fora do pedido - Índice ${i}`);
          
          // Verifique aqui se todos os campos estão chegando como esperado
          request.input('REV_COD', sql.Int, parseInt(item.REV_COD));
          request.input('PED_COD', sql.Int, parseInt(item.PED_COD));
          request.input('CUP_CDI', sql.VarChar(50), String(item.CUP_CDI));
          request.input('CUP_REF', sql.VarChar(50), String(item.CUP_REF));
          // REMOVIDO: request.input('CUP_TAM', sql.VarChar(50), item.CUP_TAM); // Não existe na CAD_IPE
          request.input('PRO_DES', sql.VarChar(255), String(item.PRO_DES));
          request.input('IPE_VTL', sql.Decimal(10, 2), parseFloat(item.IPE_VTL));
          request.input('IPE_STA', sql.Int, parseInt(item.IPE_STA));
          request.input('IPE_DFP', sql.Int, parseInt(item.IPE_DFP)); // Novo campo
          request.input('IPE_DDV', sql.DateTime, new Date(item.IPE_DDV)); // Novo campo
          request.input('USU_DEV', sql.VarChar(50), String(item.USU_DEV)); // Novo campo
          request.input('CUP_COD', sql.VarChar(50), String(item.CUP_COD)); // Novo campo
          request.input('UNI_COD', sql.VarChar(50), String(item.UNI_COD)); // Novo campo
          request.input('REMARCADO_PROX_MES', sql.Bit, item.REMARCADO_PROX_MES ? 1 : 0); // Novo campo

          const queryInsert = `
            INSERT INTO CAD_IPE (
              REV_COD, PED_COD, CUP_CDI, CUP_REF, PRO_DES, IPE_VTL, IPE_STA,
              IPE_DFP, IPE_DDV, USU_DEV, CUP_COD, UNI_COD, REMARCADO_PROX_MES
            )
            OUTPUT INSERTED.IPE_COD, INSERTED.CUP_CDI
            VALUES (
              @REV_COD, @PED_COD, @CUP_CDI, @CUP_REF, @PRO_DES, @IPE_VTL, @IPE_STA,
              @IPE_DFP, @IPE_DDV, @USU_DEV, @CUP_COD, @UNI_COD, @REMARCADO_PROX_MES
            );
          `;
          
          // Log da query SQL antes de ser executada
          console.log('  --- Query INSERT a ser executada ---');
          console.log(queryInsert);
          console.log('  --- Fim da Query INSERT ---');

          const result = await request.query(queryInsert);
          
          // ... restante do bloco de INSERT ...
        }
        // ... restante do código ...
      } catch (err) {
        // Log do ERRO COMPLETO do banco de dados
        console.error(`❌ Erro ao processar item índice ${i}:`, err.message);
        erros.push({ item, erro: err.message });
      }
    }
    // ... código restante ...
  } catch (error) {
    // ... código restante ...
  }
});




// ENDPOINT: Para login de promotores
app.post('/api/login-promotor', async (req, res) => {
  try {
    const { cpf, senha } = req.body;

    if (!cpf || !senha) {
      return res.status(400).json({
        success: false,
        error: 'CPF e senha são obrigatórios.'
      });
    }

    const pool = await getPool();
    if (!pool) {
      return res.status(500).json({
        success: false,
        error: 'Não foi possível conectar ao banco de dados.'
      });
    }

    console.log(`🔐 [login-promotor] Tentativa de login para CPF: ${cpf}`);

    const request = pool.request();
    request.input('CLI_DOC', sql.VarChar(14), cpf);
    request.input('SENHA_CLI_DOC', sql.VarChar(14), senha);

    const query = `
      SELECT CLI_COD, GRU_COD, CLI_RAZ, CLI_DOC
      FROM CAD_CLI
      WHERE CLI_DOC = @CLI_DOC
        AND CLI_DOC = @SENHA_CLI_DOC
        AND GRU_COD IN (2, 4)
        AND CLI_STA = 2;
    `;

    const result = await request.query(query);

    if (result.recordset.length > 0) {
      const promotor = result.recordset[0];
      console.log(`✅ [login-promotor] Login bem-sucedido para: ${promotor.CLI_RAZ}`);
      res.json({
        success: true,
        message: 'Login bem-sucedido!',
        promotor: {
          CLI_COD: promotor.CLI_COD,
          GRU_COD: promotor.GRU_COD,
          CLI_RAZ: promotor.CLI_RAZ,
          CLI_DOC: promotor.CLI_DOD
        }
      });
    } else {
      console.log(`❌ [login-promotor] Credenciais inválidas para CPF: ${cpf}`);
      res.status(401).json({
        success: false,
        error: 'CPF ou senha inválidos, ou promotor não autorizado.'
      });
    }

  } catch (error) {
    console.error('❌ [login-promotor] Erro geral:', error.message);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor ao tentar login. Detalhes: ' + error.message
    });
  }
});

// Endpoint para consultar produtos gerais (sp_returnCupDigitacao)
app.post('/api/consultar-produtos-gerais', async (req, res) => {
  try {
    const pool = await getPool();
    if (!pool) {
      return res.status(500).json({
        success: false,
        error: 'Não foi possível conectar ao banco de dados.'
      });
    }

    console.log(`📦 [consultar-produtos-gerais] Executando sp_returnCupDigitacao com CTL_STA = 1`);

    const request = pool.request();
    request.input('CTL_STA', sql.Int, 1);

    const result = await request.execute('sp_returnCupDigitacao');

    console.log(`✅ [consultar-produtos-gerais] SP executada com sucesso. Produtos: ${result.recordset.length}`);

    res.json({
      success: true,
      data: result.recordset
    });

  } catch (error) {
    console.error('❌ [consultar-produtos-gerais] Erro na SP:', error.message);
    res.status(500).json({
      success: false,
      error: 'Erro ao consultar produtos gerais. Detalhes: ' + error.message
    });
  }
});

// ENDPOINT: Para listar acertos pendentes do promotor (Chamada da sp_CobrancaAcerto)
app.post('/api/listar-acertos-promotor', async (req, res) => {
  try {
    const { CLI_COD } = req.body;

    if (CLI_COD === undefined || CLI_COD === null) {
      return res.status(400).json({
        success: false,
        error: 'Parâmetro CLI_COD é obrigatório.'
      });
    }

    const pool = await getPool();
    if (!pool) {
      return res.status(500).json({
        success: false,
        error: 'Não foi possível conectar ao banco de dados.'
      });
    }

    console.log(`📋 [listar-acertos-promotor] Executando sp_CobrancaAcerto para CLI_COD: ${CLI_COD}`);

    const request = pool.request();
    request.input('EMP_COD', sql.Int, 0);
    request.input('ATRASADO', sql.Bit, 0);
    request.input('RevCod', sql.Int, 0);
    request.input('TIPO', sql.Int, 4);
    request.input('EndCompleto', sql.Bit, 0);
    request.input('CliCod', sql.Int, CLI_COD);

    const result = await request.execute('sp_CobrancaAcerto');

    console.log(`✅ [listar-acertos-promotor] SP executada com sucesso. Acertos encontrados: ${result.recordset.length}`);

    res.json({
      success: true,
      data: result.recordset
    });

  } catch (error) {
    console.error('❌ [listar-acertos-promotor] Erro na SP:', error.message);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor ao executar Stored Procedure sp_CobrancaAcerto. Detalhes: ' + error.message
    });
  }
});

// ENDPOINT: Consultar Regras de Desconto
app.post('/api/consultar-regras-desconto', async (req, res) => {
    try {
        const { PED_COD } = req.body;

        if (!PED_COD) {
            return res.status(400).json({
                success: false,
                error: 'PED_COD é obrigatório para consultar regras de desconto.'
            });
        }

        const pool = await getPool();
        if (!pool) {
            return res.status(500).json({
                success: false,
                error: 'Não foi possível conectar ao banco de dados.'
            });
        }

        const request = pool.request();
        request.input('PED_COD', sql.Int, parseInt(PED_COD));

        const query = `SELECT cad_dpd.PED_COD, 
                       cad_tdp.TDP_DES, 
	               cad_dpd.GRU_COD,
	               cad_dpd.DE,
	               cad_dpd.ATE,
	               cad_dpd.PORC,
	               cad_dpd.PORC_BONUS,
	               cad_dpd.PORC_CARENCIA,
	               cad_dpd.PORC_PERDA,
	               cad_dpd.QTDE_ACERTO_CARENCIA,
	               cad_dpd.DESC_VENDA_TOTAL
                       FROM 
                         cad_dpd
                       JOIN 
                         cad_tdp
                       ON 
                         cad_dpd.TDP_COD = cad_tdp.TDP_COD WHERE PED_COD = @PED_COD`;
        
        console.log(`📊 [consultar-regras-desconto] Consultando regras para PED_COD: ${PED_COD}`);
        
        const result = await request.query(query);

        console.log(`✅ [consultar-regras-desconto] Regras encontradas: ${result.recordset.length}`);

        res.json({
            success: true,
            data: result.recordset,
            total: result.recordset.length
        });

    } catch (error) {
        console.error('❌ [consultar-regras-desconto] Erro:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno ao consultar regras de desconto.',
            details: error.message
        });
    }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});