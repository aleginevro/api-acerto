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
// ATUALIZADO: Inclui DELETE seguro e retorno de IPE_COD gerado no INSERT
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
    let inseridos = 0;
    let deletados = 0;
    const erros = [];
    const detalhes = {
      itensInseridos: [], // Array com { indice, IPE_COD, CUP_CDI }
      itensAtualizados: [], // Array com { IPE_COD, IPE_STA }
      itensDeletados: [] // Array com { IPE_COD, CUP_CDI }
    };

    for (let i = 0; i < itens.length; i++) {
      const item = itens[i];
      
      try {
        const request = pool.request();

        // ===== CASO ESPECIAL: DELETE de item fora do pedido desfeito =====
        // Quando um item fora do pedido é "desfeito" (IPE_STA = 1),
        // significa que ele não deveria mais existir no banco, então fazemos DELETE
        if (item.FORA_DO_PEDIDO && item.IPE_STA === 1) {
          console.log(`  🗑️ DELETE: Item fora do pedido desfeito - Índice ${i}`);
          
          // PRIORIDADE 1: Se o item já tem IPE_COD, usar ele diretamente (MAIS SEGURO)
          if (item.IPE_COD) {
            request.input('IPE_COD', sql.Int, parseInt(item.IPE_COD));
            request.input('IPE_DFP', sql.Int, 1); // Confirma que é fora do pedido

            const queryDeleteByCode = `
              DELETE FROM CAD_IPE 
              WHERE IPE_COD = @IPE_COD 
                AND IPE_DFP = @IPE_DFP
            `;

            console.log(`  🔍 DELETE por IPE_COD=${item.IPE_COD} (IPE_DFP=1)`);

            const result = await request.query(queryDeleteByCode);

            if (result.rowsAffected[0] > 0) {
              deletados++;
              detalhes.itensDeletados.push({ 
                IPE_COD: item.IPE_COD, 
                CUP_CDI: item.CUP_CDI 
              });
              console.log(`  ✅ Item IPE_COD=${item.IPE_COD} DELETADO com sucesso`);
            } else {
              erros.push({ item, erro: `Nenhum registro deletado para IPE_COD=${item.IPE_COD}` });
              console.log(`  ⚠️ Nenhum registro deletado para IPE_COD=${item.IPE_COD}`);
            }
          } 
          // PRIORIDADE 2: Se NÃO tem IPE_COD, usar REV_COD + PED_COD + CUP_CDI
          else {
            if (!item.REV_COD || !item.PED_COD || !item.CUP_CDI) {
              erros.push({ item, erro: 'DELETE rejeitado: faltam dados críticos (REV_COD, PED_COD ou CUP_CDI)' });
              console.log(`  ⚠️ DELETE rejeitado por falta de dados críticos`);
              continue;
            }

            request.input('REV_COD', sql.Int, parseInt(item.REV_COD));
            request.input('PED_COD', sql.Int, parseInt(item.PED_COD));
            request.input('CUP_CDI', sql.VarChar(50), String(item.CUP_CDI));
            request.input('IPE_DFP', sql.Int, 1);

            const queryDeleteByFields = `
              DELETE FROM CAD_IPE 
              WHERE IPE_DFP = @IPE_DFP 
                AND REV_COD = @REV_COD 
                AND PED_COD = @PED_COD 
                AND CUP_CDI = @CUP_CDI
            `;

            console.log(`  🔍 DELETE por campos: REV_COD=${item.REV_COD}, PED_COD=${item.PED_COD}, CUP_CDI=${item.CUP_CDI}`);

            const result = await request.query(queryDeleteByFields);

            if (result.rowsAffected[0] > 0) {
              deletados++;
              detalhes.itensDeletados.push({ 
                CUP_CDI: item.CUP_CDI,
                REV_COD: item.REV_COD,
                PED_COD: item.PED_COD
              });
              console.log(`  ✅ Item CUP_CDI=${item.CUP_CDI} DELETADO com sucesso`);
            } else {
              console.log(`  ⚠️ Nenhum registro deletado para CUP_CDI=${item.CUP_CDI}`);
            }
          }
          
          continue; // Pula para o próximo item
        }

        // ===== CASO 1: Item já tem IPE_COD (existe no pedido original) - UPDATE =====
        if (item.IPE_COD) {
          request.input('IPE_STA', sql.Int, item.IPE_STA);
          request.input('IPE_COD', sql.Int, parseInt(item.IPE_COD));

          const queryUpdate = 'UPDATE CAD_IPE SET IPE_STA = @IPE_STA WHERE IPE_COD = @IPE_COD';

          console.log(`  📝 UPDATE: IPE_COD=${item.IPE_COD}, IPE_STA=${item.IPE_STA}`);

          const result = await request.query(queryUpdate);

          if (result.rowsAffected[0] > 0) {
            sincronizados++;
            detalhes.itensAtualizados.push({ 
              IPE_COD: item.IPE_COD, 
              IPE_STA: item.IPE_STA 
            });
            console.log(`  ✅ Item IPE_COD=${item.IPE_COD} atualizado para IPE_STA=${item.IPE_STA}`);
          } else {
            erros.push({ item, erro: `Nenhum registro atualizado para IPE_COD=${item.IPE_COD}` });
            console.log(`  ⚠️ Nenhum registro atualizado para IPE_COD=${item.IPE_COD}`);
          }
        }
        // ===== CASO 2: Item NÃO tem IPE_COD (é um item "fora do pedido") - INSERT =====
        else {
          console.log(`  ➕ INSERT: Item fora do pedido - Índice ${i}`);
          
          // Validar campos essenciais
          if (!item.REV_COD || !item.PED_COD) {
            erros.push({ item, erro: 'INSERT rejeitado: faltam REV_COD ou PED_COD' });
            console.log(`  ⚠️ INSERT rejeitado por falta de REV_COD ou PED_COD`);
            continue;
          }

          // Preparar parâmetros para INSERT
          request.input('REV_COD', sql.Int, parseInt(item.REV_COD));
          request.input('PED_COD', sql.Int, parseInt(item.PED_COD));
          request.input('CUP_CDI', sql.VarChar(50), item.CUP_CDI ? String(item.CUP_CDI) : null);
          request.input('CUP_CDB', sql.VarChar(50), item.CUP_CDB ? String(item.CUP_CDB) : null);
          request.input('CUP_REF', sql.VarChar(50), item.CUP_REF ? String(item.CUP_REF) : null);
          request.input('CUP_TAM', sql.VarChar(10), item.CUP_TAM ? String(item.CUP_TAM) : null);
          request.input('PRO_DES', sql.VarChar(255), item.PRO_DES ? String(item.PRO_DES) : null);
          request.input('IPE_VTL', sql.Decimal(18, 2), item.IPE_VTL ? parseFloat(item.IPE_VTL) : 0);
          request.input('IPE_STA', sql.Int, item.IPE_STA || 9); // Default 9 = devolvido
          request.input('CUP_COD', sql.Int, item.CUP_COD ? parseInt(item.CUP_COD) : null);
          request.input('UNI_COD', sql.Int, item.UNI_COD ? parseInt(item.UNI_COD) : null);
          
          // NOVOS CAMPOS para itens fora do pedido
          request.input('IPE_DFP', sql.Int, 1); // 1 = fora do pedido
          request.input('IPE_DDV', sql.DateTime, item.IPE_DDV ? new Date(item.IPE_DDV) : new Date());
          request.input('USU_DEV', sql.VarChar(50), item.USU_DEV || 'offline');

          // INSERT com OUTPUT para retornar o IPE_COD gerado
          const queryInsert = `
            INSERT INTO CAD_IPE (
              REV_COD, PED_COD, CUP_CDI, CUP_CDB, CUP_REF, CUP_TAM, 
              PRO_DES, IPE_VTL, IPE_STA, CUP_COD, UNI_COD,
              IPE_DFP, IPE_DDV, USU_DEV
            )
            OUTPUT INSERTED.IPE_COD
            VALUES (
              @REV_COD, @PED_COD, @CUP_CDI, @CUP_CDB, @CUP_REF, @CUP_TAM,
              @PRO_DES, @IPE_VTL, @IPE_STA, @CUP_COD, @UNI_COD,
              @IPE_DFP, @IPE_DDV, @USU_DEV
            )
          `;

          console.log(`  🔍 INSERT com OUTPUT: REV_COD=${item.REV_COD}, PED_COD=${item.PED_COD}, CUP_CDI=${item.CUP_CDI}`);

          const result = await request.query(queryInsert);

          if (result.recordset && result.recordset.length > 0) {
            const novoIPE_COD = result.recordset[0].IPE_COD;
            inseridos++;
            
            // CRÍTICO: Armazenar o índice do item e o IPE_COD gerado
            detalhes.itensInseridos.push({
              indice: i, // Índice do item no array original
              IPE_COD: novoIPE_COD,
              CUP_CDI: item.CUP_CDI,
              REV_COD: item.REV_COD,
              PED_COD: item.PED_COD
            });
            
            console.log(`  ✅ Item inserido com IPE_COD=${novoIPE_COD} (índice ${i})`);
          } else {
            erros.push({ item, erro: 'INSERT não retornou IPE_COD' });
            console.log(`  ⚠️ INSERT executado mas não retornou IPE_COD`);
          }
        }

      } catch (itemError) {
        erros.push({ item, erro: itemError.message });
        console.error(`  ❌ Erro ao processar item índice ${i}:`, itemError.message);
      }
    }

    const mensagem = `Sincronização concluída: ${sincronizados} atualizados, ${inseridos} inseridos, ${deletados} deletados`;
    
    console.log(`✅ [atualizar-status-itens-ipe] ${mensagem}`);
    if (erros.length > 0) {
      console.log(`⚠️ [atualizar-status-itens-ipe] ${erros.length} erros encontrados`);
    }

    res.json({
      success: true,
      sincronizados,
      inseridos,
      deletados,
      message: mensagem,
      detalhes: detalhes, // CRÍTICO: Retornar detalhes estruturados
      erros: erros.length > 0 ? erros : undefined
    });

  } catch (error) {
    console.error('❌ [atualizar-status-itens-ipe] Erro geral:', error.message);
    res.status(500).json({
      success: false,
      error: 'Erro ao processar sincronização',
      details: error.message
    });
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