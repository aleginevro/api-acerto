const express = require('express');
const cors = require('cors');
const { sql, getPool } = require('./db'); // Certifique-se de que './db' existe e exporta 'sql' e 'getPool'
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('API Node.js para SQL Server está rodando!');
});



// Endpoint para consultar itens do pedido via REV_COD ou PED_COD
app.post('/api/sp-consulta-ipe-via-rev', async (req, res) => {
  try {
    const { REV_COD, PED_COD } = req.body; // Recebe ambos os parâmetros

    // Validação: Pelo menos um dos parâmetros deve ser fornecido
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
      // Se PED_COD for fornecido, use-o
      request.input('PED_COD', sql.Int, parseInt(PED_COD.toString() || '0'));
      console.log(`📊 [sp-ConsultaIpeViaRev] Executando SP para PED_COD: ${PED_COD}`);
    } else {
      // Caso contrário, use REV_COD (já validado que não é nulo)
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



// Endpoint para atualizar status de itens IPE ou inserir novos (existente, mas com lógica aprimorada)
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
    const erros = [];

    for (const item of itens) {
      try {
        const request = pool.request();

        // CASO 1: Item já tem IPE_COD (existe no pedido original) - UPDATE
        if (item.IPE_COD) {
          request.input('IPE_STA', sql.Int, item.IPE_STA);
          request.input('IPE_COD', sql.Int, parseInt(item.IPE_COD));

          const queryUpdate = 'UPDATE CAD_IPE SET IPE_STA = @IPE_STA WHERE IPE_COD = @IPE_COD';

          console.log(`  📝 UPDATE: IPE_COD=${item.IPE_COD}, IPE_STA=${item.IPE_STA}`);

          const result = await request.query(queryUpdate);

          if (result.rowsAffected[0] > 0) {
            sincronizados++;
            console.log(`  ✅ Item IPE_COD=${item.IPE_COD} atualizado para IPE_STA=${item.IPE_STA}`);
          } else {
            erros.push({ item, erro: `Nenhum registro atualizado para IPE_COD=${item.IPE_COD}` });
            console.log(`  ⚠️ Nenhum registro atualizado para IPE_COD=${item.IPE_COD}`);
          }
        }
        // CASO 2: Item NÃO tem IPE_COD (é um item "fora do pedido") - INSERT
        else {
            // Validar campos essenciais
            if (!item.REV_COD || !item.PED_COD || !item.CUP_CDI || !item.PRO_DES || item.IPE_VTL === undefined) {
                erros.push({ item, erro: 'Dados insuficientes. REV_COD, PED_COD, CUP_CDI, PRO_DES e IPE_VTL são obrigatórios.' });
                console.log(`  ⚠️ Item rejeitado por falta de dados essenciais`);
                continue;
            }

            // Parâmetros obrigatórios
            request.input('REV_COD', sql.Int, parseInt(item.REV_COD));
            request.input('PED_COD', sql.Int, parseInt(item.PED_COD));
            request.input('CUP_CDI', sql.VarChar(50), String(item.CUP_CDI));
            request.input('PRO_DES', sql.VarChar(255), String(item.PRO_DES));
            request.input('IPE_VTL', sql.Decimal(10, 2), parseFloat(item.IPE_VTL));
            request.input('IPE_STA', sql.Int, item.IPE_STA || 9);

            // Colunas e valores base
            const columns = ['REV_COD', 'PED_COD', 'CUP_CDI', 'PRO_DES', 'IPE_VTL', 'IPE_STA'];
            const values = ['@REV_COD', '@PED_COD', '@CUP_CDI', '@PRO_DES', '@IPE_VTL', '@IPE_STA'];

            // Adicionar CUP_CDB se presente
            if (item.CUP_CDB) {
                request.input('CUP_CDB', sql.VarChar(50), String(item.CUP_CDB));
                columns.push('CUP_CDB');
                values.push('@CUP_CDB');
            }

            // Adicionar CUP_REF se presente
            if (item.CUP_REF) {
                request.input('CUP_REF', sql.VarChar(50), String(item.CUP_REF));
                columns.push('CUP_REF');
                values.push('@CUP_REF');
            }

            // CUP_TAM foi REMOVIDO porque não existe na sua tabela CAD_IPE

            // Adicionar CUP_COD se presente
            if (item.CUP_COD) {
                request.input('CUP_COD', sql.Int, parseInt(item.CUP_COD));
                columns.push('CUP_COD');
                values.push('@CUP_COD');
            }

            // Adicionar UNI_COD se presente
            if (item.UNI_COD) {
                request.input('UNI_COD', sql.Int, parseInt(item.UNI_COD));
                columns.push('UNI_COD');
                values.push('@UNI_COD');
            }

            const queryInsert = `
                INSERT INTO CAD_IPE (${columns.join(', ')})
                VALUES (${values.join(', ')})
            `;

            console.log(`  📝 INSERT: PED_COD=${item.PED_COD}, CUP_CDI=${item.CUP_CDI}, REV_COD=${item.REV_COD}, IPE_STA=${item.IPE_STA || 9}`);

            const result = await request.query(queryInsert);

            if (result.rowsAffected[0] > 0) {
                inseridos++;
                console.log(`  ✅ Item CUP_CDI=${item.CUP_CDI} inserido com sucesso no PED_COD=${item.PED_COD}`);
            } else {
                erros.push({ item, erro: `Falha ao inserir item CUP_CDI=${item.CUP_CDI}` });
            }
        }

      } catch (itemError) {
        console.error(`  ❌ Erro ao processar item (IPE_COD: ${item.IPE_COD || 'NOVO'}, CUP_CDI: ${item.CUP_CDI}):`, itemError.message);
        erros.push({ item, erro: itemError.message });
      }
    }

    console.log(`✅ [atualizar-status-itens-ipe] Concluído: ${sincronizados} atualizados, ${inseridos} inseridos de ${itens.length} total.`);

    res.json({
      success: true,
      sincronizados,
      inseridos,
      total: itens.length,
      erros: erros.length > 0 ? erros : undefined,
      message: `${sincronizados} atualizados e ${inseridos} inseridos com sucesso`
    });

  } catch (error) {
    console.error('❌ [atualizar-status-itens-ipe] Erro geral:', error.message);
    res.status(500).json({
      success: false,
      error: 'Erro ao processar sincronização: ' + error.message
    });
  }
});



// NOVO ENDPOINT: Para login de promotores
app.post('/api/login-promotor', async (req, res) => {
  try {
    const { cpf, senha } = req.body; // 'senha' aqui é o mesmo que 'cpf' conforme discutido

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
    request.input('CLI_DOC', sql.VarChar(14), cpf); // CPF formatado ou não, depende de como está no DB
    // Aqui usamos o CPF como a "senha" também, conforme o requisito
    request.input('SENHA_CLI_DOC', sql.VarChar(14), senha);


    const query = `
      SELECT CLI_COD, GRU_COD, CLI_RAZ, CLI_DOC
      FROM CAD_CLI
      WHERE CLI_DOC = @CLI_DOC
        AND CLI_DOC = @SENHA_CLI_DOC -- Assumindo que a senha é o próprio CLI_DOC
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
          CLI_DOC: promotor.CLI_DOC
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
    request.input('CTL_STA', sql.Int, 1); // Nome correto do parâmetro

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


// NOVO ENDPOINT: Para listar acertos pendentes do promotor (Chamada da sp_CobrancaAcerto)
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
    request.input('TIPO', sql.Int, 4); // 4 = somente header
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


app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});